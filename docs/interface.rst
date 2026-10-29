The interface
=============

The window is three regions: a toolbar on top, a column of track labels on the
left, and one canvas per track filling the rest.

Toolbar
-------

* **Assembly selector** — switch genome; annotation reloads, sequence follows
* **Search box** — locus, gene symbol, or a motif pattern
* **Zoom controls** — plus, minus, and a fit-to-window button
* **Export** — PNG, SVG or PDF for the current view
* **Split view** — show two, three or four independent loci side by side
* **Language** — the ``中`` / ``EN`` button at the far right switches the whole
  interface between Chinese and English. The choice is remembered across
  launches, and the view you are looking at is restored.

Track labels
------------

Every track has a label cell on the left. The label carries:

* a checkbox to show or hide the track,
* the track name (click to open settings),
* a one-line summary — gene count, signal range, or data source,
* for imported tracks, a menu with *remove*, *rename* and *reload*.

Track types
-----------

.. list-table::
   :header-rows: 1
   :widths: 22 78

   * - Track
     - What it draws
   * - Ideogram
     - Cytobands for the whole chromosome, with a marker for the visible window
   * - Ruler
     - Tick marks and coordinates; the scale switches units as you zoom
   * - RefSeq genes
     - Gene models; click a gene to expand its transcripts
   * - Signal
     - bigWig or bedGraph values as a filled area, autoscaled or fixed
   * - GC content
     - GC percentage in windows across the visible range
   * - Sequence
     - Coloured bases, shown once each base has enough pixels

Gene track settings
-------------------

Click the gene track label to open its panel.

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Setting
     - Effect
   * - Display mode
     - *Expanded* draws every transcript; *Collapsed* draws one row per gene
   * - Colour by
     - Strand, or a single colour
   * - Labels
     - Show gene symbols, transcript accessions, or nothing
   * - Height
     - Row height in pixels, which also controls how many genes fit

Signal track settings
---------------------

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Setting
     - Effect
   * - Scale
     - *Autoscale* fits the visible window; *Fixed* pins the range
   * - Range
     - Min and max when the scale is fixed
   * - Colour
     - Per-track colour; groups can share one tint
   * - Draw mode
     - Filled area, bar, or line
   * - Overlay
     - Stack tracks, or overlay several samples in one row

Display options
---------------

The appearance menu toggles the dark theme, the label density, and whether the
whole-genome overview starts expanded. Preferences are stored per user and
restored on the next launch.
