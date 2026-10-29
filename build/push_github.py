#!/usr/bin/env python3
"""把 Orbit 推送到 GitHub（沙箱里 github.com:443 被拦，所以全程走 api.github.com）。

    python build/push_github.py            # 推送（不存在就建仓库）
    python build/push_github.py --dry-run  # 只列出要上传的文件

Token 来源：环境变量 GH_TOKEN，或 ~/.workbuddy-ai/gh_token.txt。

只推源码 + 注释数据（data/ann、data/catalog.json）；data/genomes（2.9 GB 本地 2bit）、
data/loaded（用户导入的轨道）、dist/ 一律不进仓库。
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = "https://api.github.com"
OWNER = os.environ.get("GH_OWNER", "junjunlab")
REPO = os.environ.get("GH_REPO", "Orbit")
BRANCH = "main"
DESCRIPTION = "Orbit — 离线基因组浏览器：RefSeq 注释编译成本地二进制索引，序列按窗口从 UCSC 远程 2bit 拉取"
TOPICS = ["genomics", "genome-browser", "igv", "bioinformatics", "pyside6", "qtwebengine"]

# 不进仓库的路径（相对 ROOT）
SKIP_DIRS = {
    "dist", ".git", "__pycache__", "shots", ".workbuddy", ".workbuddy-ai",
    "data/genomes", "data/loaded", "data/raw", "build/pyi", "build/.cache",
    "docs/ui-review", "docs/_build",
}
SKIP_SUFFIX = {
    ".pyc", ".pyo", ".log", ".spec", ".tmp", ".pkl",
    ".mo",          # Sphinx 在构建时由 .po 现编，仓库里只留 .po
}
SKIP_NAME_PREFIX = ("_", "REBUILD_", "shot")

# 以下划线开头但必须进仓库的目录（Sphinx 的静态资源 / 模板）
KEEP_DIRS = {"docs/_static", "docs/_templates"}

# 根目录放行的文件（其余根目录文件一律不推）
ROOT_FILES = {
    "README.md", ".gitignore", "requirements.txt",
    "启动.bat", "start-window.bat", "LICENSE",
    ".readthedocs.yaml",
}

# fine-grained PAT 没有 Workflows: write 时，任何含「根目录 .github/workflows/*」的
# tree / contents 写入都返回 403 Resource not accessible by personal access token
# （Contents: write 也救不了，已实测：.github/README.md 可以，.github/workflows/x.yml 不行）。
# 现在 token 已授权，workflow 正常放进 tree；下面只保留一个「被拒就剔除再试」的兜底。
WORKFLOW_PREFIX = ".github/workflows/"


def token() -> str:
    t = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if t:
        return t.strip()
    p = Path.home() / ".workbuddy-ai" / "gh_token.txt"
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    raise SystemExit("找不到 GitHub token（GH_TOKEN 或 ~/.workbuddy-ai/gh_token.txt）")


def api(method: str, path: str, payload=None, tok: str = "", raw: bool = False):
    url = path if path.startswith("http") else API + path
    data = None
    headers = {
        "Authorization": f"Bearer {tok}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "orbit-push",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            body = r.read()
            return (r.status, body if raw else (json.loads(body) if body else {}))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:600]
        return e.code, {"error": detail}


def _arg(name: str) -> str | None:
    """取 --xxx value 形式的命令行参数。"""
    for i, a in enumerate(sys.argv):
        if a == name and i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


def collect() -> list[Path]:
    out: list[Path] = []
    for p in sorted(ROOT.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(ROOT).as_posix()
        if any(rel == d or rel.startswith(d + "/") for d in SKIP_DIRS):
            continue
        if p.suffix in SKIP_SUFFIX:
            continue
        parts = rel.split("/")
        keep_dir = any(rel.startswith(d + "/") for d in KEEP_DIRS)
        if not keep_dir and any(part.startswith(SKIP_NAME_PREFIX) for part in parts[:-1]):
            continue
        if parts[-1].startswith(("_", "REBUILD_", "shot")) and p.suffix != ".py":
            continue
        # 根目录只保留几个明确的文件
        if len(parts) == 1 and rel not in ROOT_FILES:
            continue
        out.append(p)
    return out


def main() -> int:
    dry = "--dry-run" in sys.argv
    tok = token()
    everything = collect()
    files = everything
    total = sum(f.stat().st_size for f in files)
    print(f"待推送 {len(files)} 个文件，共 {total/1e6:.1f} MB")
    if dry:
        for f in files:
            print(f"  {f.relative_to(ROOT).as_posix():60s} {f.stat().st_size/1e3:9.1f} KB")
        return 0

    st, me = api("GET", "/user", tok=tok)
    if st != 200:
        raise SystemExit(f"token 无效：{st} {me}")
    owner = me["login"]
    print(f"账号：{owner}")

    st, repo = api("GET", f"/repos/{owner}/{REPO}", tok=tok)
    if st == 404:
        print(f"仓库 {owner}/{REPO} 不存在，创建中 ...")
        st, repo = api("POST", "/user/repos", {
            "name": REPO, "description": DESCRIPTION, "private": False,
            "has_issues": True, "has_wiki": False, "auto_init": False,
        }, tok=tok)
        if st not in (200, 201):
            raise SystemExit(f"建仓库失败：{st} {repo}\n"
                             "（fine-grained token 需要 Administration: write 或 '创建仓库' 权限）")
        api("PUT", f"/repos/{owner}/{REPO}/topics", {"names": TOPICS}, tok=tok)
    elif st != 200:
        raise SystemExit(f"查仓库失败：{st} {repo}")

    # 已有提交就基于它做增量，否则全新建
    base_commit = None
    st, ref = api("GET", f"/repos/{owner}/{REPO}/git/ref/heads/{BRANCH}", tok=tok)
    if st != 200:
        # 空仓库：Git Data API 建不了 blob（409 Git Repository is empty），
        # 先用 Contents API 落一个文件把首个提交造出来。
        seed = ROOT / ".gitignore"
        st2, res2 = api("PUT", f"/repos/{owner}/{REPO}/contents/.gitignore", {
            "message": "init", "content": base64.b64encode(seed.read_bytes()).decode(),
        }, tok=tok)
        if st2 not in (200, 201):
            raise SystemExit(f"初始化空仓库失败：{st2} {res2}")
        print("空仓库 → 已用 .gitignore 建立首个提交")
        st, ref = api("GET", f"/repos/{owner}/{REPO}/git/ref/heads/{BRANCH}", tok=tok)
    if st == 200:
        base_commit = ref["object"]["sha"]
        print(f"基于已有提交 {base_commit[:8]} 增量推送")

    cache_path = ROOT / "build" / ".push_cache.json"
    cache: dict[str, list] = {}
    if cache_path.exists():
        try:
            cache = json.loads(cache_path.read_text())
        except Exception:
            cache = {}

    blobs = []
    for i, f in enumerate(files, 1):
        rel = f.relative_to(ROOT).as_posix()
        raw = f.read_bytes()
        st_size = len(raw)
        # 缓存键必须是内容哈希，不能用文件大小：
        # "1.0.0" → "1.0.1" 这种等长改动会让大小比对失效，改动被静默跳过
        # （曾经因此让 __init__.py 的 __version__ 停在旧值，dmg 名字对不上 tag）。
        digest = hashlib.sha1(raw).hexdigest()
        hit = cache.get(rel)
        if hit and isinstance(hit[0], str) and hit[0] == digest:
            blobs.append({"path": rel, "mode": hit[1], "type": "blob", "sha": hit[2]})
            print(f"  [{i:3d}/{len(files)}] {rel}  (cached)")
            continue
        content = base64.b64encode(raw).decode()
        st, res = api("POST", f"/repos/{owner}/{REPO}/git/blobs",
                      {"content": content, "encoding": "base64"}, tok=tok)
        if st not in (200, 201):
            raise SystemExit(f"上传 {rel} 失败：{st} {res}")
        mode = "100755" if os.name != "nt" and os.access(f, os.X_OK) else "100644"
        cache[rel] = [digest, mode, res["sha"]]
        blobs.append({"path": rel, "mode": mode, "type": "blob", "sha": res["sha"]})
        print(f"  [{i:3d}/{len(files)}] {rel}  {st_size/1e3:.0f} KB")
    cache_path.write_text(json.dumps(cache))

    # 不用 base_tree：我们要的树就是这些文件，从头建更干净。
    # 注意 tree 必须是「完整」的：如果漏掉 .github/workflows/*，更新分支时会把
    # 仓库里已有的 workflow 删掉（曾经因此每次推送都多出一个「删了再加回来」的提交）。
    st, tree = api("POST", f"/repos/{owner}/{REPO}/git/trees", {"tree": blobs}, tok=tok)
    dropped_wf = False
    if st not in (200, 201) and any(b["path"].startswith(WORKFLOW_PREFIX) for b in blobs):
        # 兜底：token 缺 Workflows: write 时整棵树都会被拒，去掉 workflow 再试一次
        keep = [b for b in blobs if not b["path"].startswith(WORKFLOW_PREFIX)]
        st2, tree2 = api("POST", f"/repos/{owner}/{REPO}/git/trees", {"tree": keep}, tok=tok)
        if st2 in (200, 201):
            print("! token 缺 Workflows: write → 本次跳过 .github/workflows/*")
            st, tree, dropped_wf = st2, tree2, True
    if st not in (200, 201):
        raise SystemExit(f"建 tree 失败：{st} {tree}")

    st, commit = api("POST", f"/repos/{owner}/{REPO}/git/commits", {
        "message": _arg("--message") or "Orbit: Qt native window, 18 assemblies, remote 2bit sequence",
        "tree": tree["sha"],
        **({"parents": [base_commit]} if base_commit else {}),
    }, tok=tok)
    if st not in (200, 201):
        raise SystemExit(f"建 commit 失败：{st} {commit}")

    if base_commit:
        st, res = api("PATCH", f"/repos/{owner}/{REPO}/git/refs/heads/{BRANCH}",
                      {"sha": commit["sha"], "force": True}, tok=tok)
    else:
        st, res = api("POST", f"/repos/{owner}/{REPO}/git/refs",
                      {"ref": f"refs/heads/{BRANCH}", "sha": commit["sha"]}, tok=tok)
    if st not in (200, 201):
        raise SystemExit(f"更新分支失败：{st} {res}")

    head = commit["sha"]
    print(f"\n分支已更新：https://github.com/{owner}/{REPO}  ({head[:8]})")

    # 只有「token 缺 Workflows 权限、tree 里被剔掉」时，才需要单独补 workflow。
    # 正常情况下 workflow 已在 tree 里，什么都不用做。
    if dropped_wf:
        for wf in everything:
            rel = wf.relative_to(ROOT).as_posix()
            if not rel.startswith(WORKFLOW_PREFIX):
                continue
            local = wf.read_bytes()
            st0, cur = api("GET", f"/repos/{owner}/{REPO}/contents/{rel}", tok=tok)
            payload = {"message": _arg("--message") or f"ci: {rel}",
                       "content": base64.b64encode(local).decode()}
            if st0 == 200 and cur.get("sha"):
                payload["sha"] = cur["sha"]
            st, res = api("PUT", f"/repos/{owner}/{REPO}/contents/{rel}", payload, tok=tok)
            if st in (200, 201):
                head = res["commit"]["sha"]
                print(f"workflow 已单独补上：{rel}  ({head[:8]})")
            else:
                print(f"\n! {rel} 未能上传（{st}）—— fine-grained token 缺少 Workflows 权限。")
                print("  两种解法（任选其一）：")
                print("    1) https://github.com/settings/personal-access-tokens → 编辑该 token")
                print("       → Repository permissions → Workflows → Read and write → 保存后重跑本脚本")
                print(f"    2) 网页新建 https://github.com/{owner}/{REPO}/new/{BRANCH}"
                      f"/.github/workflows  → 文件名 build.yml，粘贴本地 {rel} 的内容")

    # --tag v1.0.0：打 tag 会触发 Actions 里的 Release 构建（三平台安装包）
    tag = None
    for i, a in enumerate(sys.argv):
        if a == "--tag" and i + 1 < len(sys.argv):
            tag = sys.argv[i + 1]
    if tag:
        # 已存在同名 tag 时先删掉（包括它挂的 Release），做成可重复执行
        st_exist, old_ref = api("GET", f"/repos/{owner}/{REPO}/git/ref/tags/{tag}", tok=tok)
        if st_exist == 200:
            api("DELETE", f"/repos/{owner}/{REPO}/git/refs/tags/{tag}", tok=tok)
            st_rel, rels = api("GET", f"/repos/{owner}/{REPO}/releases/tags/{tag}", tok=tok)
            if st_rel == 200 and rels.get("id"):
                api("DELETE", f"/repos/{owner}/{REPO}/releases/{rels['id']}", tok=tok)
            print(f"旧 tag {tag} 已移除，重新指向 {head[:8]}")
        st, obj = api("POST", f"/repos/{owner}/{REPO}/git/tags", {
            "tag": tag, "message": f"Orbit {tag}", "object": head,
            "type": "commit",
        }, tok=tok)
        if st not in (200, 201):
            print(f"! 建 tag 对象失败：{st} {obj}")
        else:
            st, res = api("POST", f"/repos/{owner}/{REPO}/git/refs",
                          {"ref": f"refs/tags/{tag}", "sha": obj["sha"]}, tok=tok)
            print(f"tag {tag} 已推送 → {head[:8]}" if st in (200, 201)
                  else f"! 推 tag 失败：{st} {res}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
