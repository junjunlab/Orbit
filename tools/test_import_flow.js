(async () => {
  const ig = window.__igv;
  const before = ig.S.bw.list.length;
  const text = "track type=bedGraph\nchr1\t0\t1000\t7\nchr1\t1000\t2000\t9\nchr1\t2000\t3000\t11\n";
  const f = new File([text], "inline_demo.bedgraph", { type: "text/plain" });
  await ig.importFiles([f]);
  return {
    before,
    after: ig.S.bw.list.length,
    lastTracks: ig.S.bw.list.slice(-2).map((t) => ({ id: t.id, loaded: !!t.loaded })),
    loadedIds: ig.S.loaded.list.map((t) => t.id),
  };
})();
