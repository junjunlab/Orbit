"""把普通 gzip 压缩的 BAM 转成 BGZF（测试用，仅支持小文件单块）。"""
import gzip
import struct
import sys
import zlib

EOF_BLOCK = bytes.fromhex("1f8b08040000000000ff0600424302001b0003000000000000000000")


def block(raw: bytes) -> bytes:
    c = zlib.compressobj(6, zlib.DEFLATED, -15)
    payload = c.compress(raw) + c.flush()
    bsize = 12 + 6 + len(payload) + 8
    if bsize > 65536:
        raise SystemExit("block too big")
    head = (b"\x1f\x8b\x08\x04" + b"\x00" * 4 + b"\x00\xff"
            + struct.pack("<H", 6) + b"BC" + struct.pack("<H", 2)
            + struct.pack("<H", bsize - 1))
    return head + payload + struct.pack("<II", zlib.crc32(raw) & 0xFFFFFFFF, len(raw))


def main(src: str, dst: str) -> None:
    raw = gzip.decompress(open(src, "rb").read())
    out = bytearray()
    for i in range(0, len(raw), 60000):
        out += block(raw[i:i + 60000])
    out += EOF_BLOCK
    open(dst, "wb").write(bytes(out))
    print(f"{src} -> {dst}  raw={len(raw)} bgzf={len(out)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
