Exporting
=========

The export button captures exactly what is on screen — same colours, same
labels, same zoom — and writes it to a file.

Formats
-------

.. list-table::
   :header-rows: 1
   :widths: 14 22 64

   * - Format
     - Extension
     - When to use it
   * - PNG
     - ``.png``
     - Slides, quick sharing. Rendered at the current device pixel ratio, so it
       stays sharp on a HiDPI display.
   * - SVG
     - ``.svg``
     - Editing in Illustrator or Inkscape. Text stays text, strokes stay
       strokes.
   * - PDF
     - ``.pdf``
     - Journal figures. Vector, with an embedded font.

File names are generated from the locus so you can export several views without
renaming anything::

   hg38_chr17_7668402-7687550.png

What is included
----------------

* Every visible track, in the same order and with the same heights
* Track labels and the axis on the left
* Split view: all panes side by side, at their on-screen widths
* The selection highlight, if there is one

Hidden tracks are not exported. If you want a figure without the ruler,
uncheck it first — the export is a photograph of the window, not a separate
renderer with its own options.

Vector export notes
-------------------

SVG and PDF are drawn with real vector primitives, not by embedding a bitmap.
A few consequences are worth knowing:

* Signal tracks become one path per sample, so they scale cleanly
* Gene models keep their exon rectangles and arrows as separate objects
* Dense labels are laid out exactly as on screen, including the ones that sit
  on top of features — the export does not re-flow text
* Very large exports (a whole chromosome at base resolution) produce large
  files; export a window instead

.. tip::

   For a publication figure, zoom until the scale reads something like
   ``10 bp/px``, then export SVG. Illustrator opens it with every label still
   editable, so you can nudge a gene name without redrawing anything.

Batch export
------------

There is no batch mode yet. For many views, use split view to place up to four
loci in one canvas and export once — each pane keeps its own coordinates.
