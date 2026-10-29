How it works
============

Orbit is small because it does very little at runtime. Three formats are read
directly, and everything else is prepared once, at build time.

Sequence: 2bit
--------------

The 2bit format packs four bases into a byte plus an index of block offsets, so
a random 20 kb window can be decoded without touching the rest of the file.
Orbit's reader (:mod:`igvlocal.twobit`) implements the format with the standard
library only — no py2bit, no C extension.

When the file is remote, the same reader works through HTTP Range requests:
it fetches the index once, then only the blocks the window overlaps. This is
why the installer does not ship a genome.

Annotation: igvbin
------------------

RefSeq ``refGene`` is a flat table of exon starts and ends encoded as
comma-separated strings. Parsing it at startup costs seconds and hundreds of
megabytes. So it is compiled once into ``genes.igvbin``:

* a header with chromosome count and offsets
* a per-chromosome block of gene records, sorted by start
* an interned string pool for symbols and accessions
* a transcript table, so expansion does not re-read the gene

Loading a chromosome becomes a single ``mmap`` slice plus a binary search,
which is why a whole chromosome of genes appears in milliseconds. The reader
(:mod:`igvlocal.annbin`) is about 300 lines and has no dependencies.

Signal: bigWig
--------------

bigWig is a binary, indexed format: a B-tree of data blocks and an R-tree of
genomic ranges. Orbit parses both (:mod:`igvlocal.bigwig`) and reads only the
blocks covering the window.

That means a 40 GB bigWig behaves like a small file — the cost of opening it is
a few hundred bytes of index, not the whole track. bedGraph files are the
exception: they have no index, so they are read into memory.

The server
----------

The backend uses the standard library ThreadingHTTPServer, bound to localhost
by default. It serves the frontend and JSON APIs; the frontend composes exports.

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Endpoint
     - Purpose
   * - ``/`` and static files
     - The frontend, served from ``web/``
   * - ``/api/...``
     - JSON: catalog, genes in a window, sequence, bigWig values, search
   * - Frontend export
     - ``composePlot`` / ``composeVector`` generate the downloadable files

The window itself is QtWebEngine, so the frontend is ordinary browser code —
Canvas for tracks, plain DOM for controls, no framework. The same page runs in
Chrome if you pass ``--browser``, which is how most of the UI is tested.

Why this shape
--------------

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Decision
     - Reason
   * - No framework
     - The whole frontend is one file and loads instantly; there is no build step
   * - Standard library only
     - No wheels to compile, no version conflicts, and the frozen build is small
   * - Compile annotations ahead of time
     - Startup cost moves to the build machine, where it is paid once
   * - Stream sequence
     - A 3 GB genome is not something you want in an installer
   * - Qt over a web view
     - Same rendering engine as Chrome, but a real window and real file dialogs
