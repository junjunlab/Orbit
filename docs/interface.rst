The interface
=============

Orbit has a top toolbar, a left sidebar, and a scrollable genome-view area.
Within the view, each track has a label cell and one canvas per locus panel.
The status bar at the bottom reports the active locus, window size, scale,
assembly, and data-request timing.

Toolbar
-------

The controls run from assembly selection and search to data import, comparison,
and export:

* **Assembly selector** — click the assembly name beside the Orbit logo and
  choose a genome. Select **hg38** before following the human-gene examples.
  Switching assembly opens a default region and updates the annotation and
  sequence source; it does not translate old coordinates or imported files.
* **Search box** — enter a gene symbol or a chromosome-qualified coordinate,
  such as ``TP53`` or ``chr17:7,668,402-7,687,550``, and press :kbd:`Enter`.
  Multiple resolvable terms, for example ``TP53, BRCA1``, create separate
  panels (up to five). This searches the bundled annotation, not motif patterns.
* **GTF search** — appears after a GTF/GFF annotation is imported. It searches
  imported gene names; its selector limits the search to all imported gene
  tracks or a specific one.
* **Import** — opens the local file chooser; drag-and-drop is an alternative.
  Wait for the import progress panel to finish before inspecting the track.
* **Split** — choose **1 panel** through **5 panels** for independent loci.
* **Export** — opens **Include track labels**, **PNG**, **SVG**, and **PDF**.
  It is the download-arrow button next to Split, not a keyboard save command.
* **Motif** — opens a separate dialog for nucleotide, IUPAC, or regular
  expression patterns. Hits are added as plus/minus tracks; reference sequence
  is required and motif hits are hidden when the window exceeds 1 Mb.
* **Whole chromosome** — fits the current chromosome in the active panel.
  **- / +** zoom out/in around that panel's centre.
* **Theme** — the sun icon switches light/dark appearance. The language button
  at the far right switches Chinese/English and reloads the page.

.. figure:: examples/interface-overview.png
   :align: center
   :width: 100%
   :alt: Orbit toolbar, sidebar, track labels, and genome-view canvases.

   Interface overview at ``ACTB`` on hg38: choose the assembly before
   searching. The sidebar manages track visibility and selected-gene details;
   the main label cells contain settings buttons beside the plotted data.

Track labels
------------

Distinguish the **sidebar list** from the **label cell beside a canvas**:

* Expand **Tracks** in the sidebar to reveal the built-in visibility
  checkboxes; this section is initially collapsed. Imported annotations and
  sequence tracks have their checkboxes under **Imported**, and quantitative
  tracks under **Signal tracks**.
* Click a name in an imported/signal sidebar list to select a track, not to
  open its settings. Hold :kbd:`Ctrl` while clicking names to select several.
  Right-click selected signal tracks for shared-axis or shared-colour actions;
  imported-track batch actions include deletion.
* Click a **gear** in a canvas track label to open that track's settings.
  Right-clicking a RefSeq, GC, signal, or imported gene-track label also opens
  its settings. There is no universal rename/reload menu.
* Drag a canvas track label vertically to reorder rows. Drag the boundary
  between label cells and canvases horizontally to change the label-column
  width; double-click that boundary to reset the width.
* A remove action deletes an imported copy from Orbit's loaded-data area.
  Unchecking a track only hides it; use that when the data must be kept.

Track types
-----------

.. list-table::
   :header-rows: 1
   :widths: 22 78

   * - Track
     - What it draws and how to use it
   * - Ideogram
     - Cytobands for the current chromosome and a red marker for the window.
       Click within the ideogram to move the window along that chromosome.
   * - Ruler
     - Coordinates and ticks that change scale with zoom. Search coordinates
       are 1-based with an inclusive end.
   * - RefSeq / imported genes
     - Merged gene models or individual transcript rows. Click a model or its
       text label for details; use the small plus/minus control to expand it.
   * - Signal
     - bigWig/bedGraph values or BAM coverage as bars. The track gear controls
       range and colour; grouping shares a scale, not a canvas overlay.
   * - BAM alignments
     - Stacked reads below coverage, with a separate Align checkbox. The main
       BAM checkbox must also be on for the read row to appear.
   * - GC content
     - Windowed GC percentage on a fixed 30%-70% axis. Off initially; requires
       an available reference sequence source.
   * - Sequence
     - Reference bases at about 1.2 bp/px or closer. Off initially; the strand
       arrow shows the complementary strand, and Aa opens translation controls.
   * - Whole-genome overview
     - Initially a compact strip. Expand it to see chromosome rows and click
       a row to navigate; each split panel has its own overview.

Gene track settings
-------------------

Open the gear in **RefSeq** or an imported GTF/GFF track-label cell. These are
the actual options in the gene settings popover:

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Setting
     - Effect
   * - Expand all
     - Show each transcript on its own row. Genes newly revealed by panning or
       zooming also remain expanded while this option is on.
   * - Collapse all
     - Draw a merged model for each gene and clear individual expansion choices.
   * - Plus-strand / Minus-strand colour
     - Choose colours independently with a palette or the custom colour picker.
   * - CDS / UTR colour
     - Set the coding and untranslated feature colours.
   * - Reset / Done
     - Reset this track's colour/expansion choices, or close the popover.

Imported gene tracks follow the RefSeq colours unless a colour is set on that
imported track itself. An imported track's overrides do not recolour other
tracks. There are no label-mode or row-height controls in this popover.

For just one gene, click the small **+** near the end of its model (or **-**
when expanded). When space is tight the button can appear on the left. Click
the gene model or name to populate **Selection / details** with its locus,
strand, length, transcript count, and a transcript/exon/CDS table.
Multi-transcript genes also have a Show / Hide control in those details. Clicking
this model to select it is distinct from clicking its expansion button.

.. figure:: examples/genes-expanded.png
   :align: center
   :width: 100%
   :alt: An annotation track with transcripts expanded into separate rows.

   Expanded ``EGFR`` transcripts on hg38 allow exon/CDS structure to be compared
   row by row. Expand all / Collapse all act on one annotation track; the small
   per-gene button affects only that gene.

Signal track settings
---------------------

For a bigWig, bedGraph, or BAM coverage row, click its gear or right-click its
canvas label. Changes are applied to the view as you edit them.

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Setting
     - Effect
   * - Colour
     - Pick a palette colour or a custom colour for the signal bars.
   * - Data range
     - Auto follows the visible window; Fixed enables Min / max inputs and
       keeps that range while navigating.
   * - Log scale (log10)
     - Uses a positive logarithmic scale for signals spanning orders of
       magnitude.
   * - Track group
     - Assign a group or create a new one. Enable group autoscale to use a
       common range across its members, which remain in separate rows.
   * - Colour alignments by strand
     - Available for BAM; changes the read row from the default grey to
       strand-specific colours.
   * - Remove this track
     - Removes an imported copy, or hides a bundled signal track.
   * - Reset / Done
     - Reset this signal track's settings, or close the popover.

To share a range quickly, select several signal-track names in the sidebar
with :kbd:`Ctrl` + click, then right-click a selected name and choose
**Group autoscale**. The same batch menu provides shared colours. The settings
do not offer line/area drawing modes or sample overlays.

Display options
---------------

The sun button switches light/dark theme for the current view. The
whole-genome overview's small triangle expands or collapses its chromosome
rows; it is a direct button, not an appearance menu. There is no global
label-density option. The current build resets track presentation preferences on a
new page load, so do not rely on refresh, language switching, or reopening the
application to preserve track order, colours, or expanded transcripts.
Previously imported files can remain in the sidebar while their checkboxes
start off; check them again to display them.

Split-panel operation
~~~~~~~~~~~~~~~~~~~~~

1. Click **Split** and select 2-5 panels, or enter several genes in the main
   search. Panels share one assembly and one track list, but have independent
   loci and zoom levels.
2. Click a panel's **Locus** cell to make it active. Its highlight identifies
   the target of the main search, arrow keys, and toolbar zoom. Clicking the
   same cell again can remove the highlight without changing that target.
3. Enter a gene or chromosome-qualified coordinate directly in a panel's
   Locus field and press :kbd:`Enter` to change just that panel. Dragging a
   canvas pans that panel; mouse-wheel and double-click zoom target the panel
   under the pointer.
4. Close a panel using its **x**, or choose **1 panel** in Split. Lowering
   the count removes panels from the right.

.. figure:: examples/panels-four.png
   :align: center
   :width: 100%
   :alt: Four side-by-side locus panels with separate position fields.

   Four-panel comparison of ``ACTB``, ``EGFR``, ``TP53``, and ``MYC`` on hg38.
   Each position field changes one locus; the active cell controls where
   main-search and keyboard actions are sent.

Export workflow
~~~~~~~~~~~~~~~

After arranging tracks and panels, click **Export** beside Split, set
**Include track labels**, and choose **PNG**, **SVG**, or **PDF**. The output
contains visible track rows and all current panels, not the toolbar/sidebar.
The filename includes the assembly, the active locus, and a ``_splitN`` suffix
for multiple panels. PNG is 2x raster; SVG is vector; PDF is vector with an
embedded CJK font when available, with a reported raster fallback otherwise.
See :doc:`data-export` for the complete workflow.

Keyboard and mouse reference
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Outside text inputs, :kbd:`←` / :kbd:`→` pan the active panel by 35% of its
window, :kbd:`+` / :kbd:`=` zoom in twofold, and :kbd:`-` / :kbd:`_` zoom out
twofold. :kbd:`/` focuses and selects the main search text. :kbd:`Esc`
dismisses settings/context popovers and clears gene selection outside inputs.
In search fields, :kbd:`↑` / :kbd:`↓` select suggestions and :kbd:`Enter`
submits; :kbd:`Esc` dismisses suggestions. Navigation keys are not handled
while the Motif dialog is open.

Horizontal canvas dragging pans, rather than selecting a genomic interval.
The mouse wheel zooms around the pointer and double-clicking zooms in. There
are no application bindings for :kbd:`Ctrl+F`, :kbd:`Ctrl+S`, a Shift-arrow
fine-pan step, or :kbd:`Home`; use search, Export, and Whole chromosome in the
toolbar for those tasks.
