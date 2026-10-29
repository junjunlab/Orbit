Quick start
===========

Five minutes from launch to a figure.

1. Open a locus
---------------

Type a locus into the search box at the top and press :kbd:`Enter`. All of
these work:

.. code-block:: text

   TP53
   chr17:7,668,402-7,687,550
   chr17:7668402-7687550
   7,668,402-7,687,550

A gene symbol jumps to its full extent; coordinates are 1-based and inclusive,
matching the IGV convention.

2. Choose an assembly
---------------------

The assembly selector sits next to the search box. Orbit ships with 18
assemblies — see :doc:`assemblies`. Changing the assembly keeps the locus
text if the chromosome name also exists in the new genome.

3. Look at the tracks
---------------------

The left column lists tracks. Click a name to open its settings, or use the
checkbox to hide it. From top to bottom you normally see:

* **Ideogram** — cytobands with the current view marked
* **Ruler** — genomic coordinates and scale
* **RefSeq genes** — gene models, expandable to transcripts
* **Signal tracks** — any bigWig you have loaded
* **GC content** — computed from the sequence on demand
* **Sequence** — bases, once you are zoomed in far enough

4. Load your own data
---------------------

Drag a file onto the window, or press **Import** in the toolbar. bigWig,
bedGraph, BAM, GTF/GFF and FASTA are recognised by extension. Details in
:doc:`data-import`.

5. Export the view
------------------

Press the export button in the toolbar and choose PNG, SVG or PDF. Vector
formats stay editable in Illustrator and Inkscape. Details in
:doc:`data-export`.

Keyboard essentials
-------------------

.. list-table::
   :header-rows: 1
   :widths: 34 66

   * - Key
     - Action
   * - :kbd:`←` / :kbd:`→`
     - Pan by half a screen
   * - :kbd:`Shift` + :kbd:`←` / :kbd:`→`
     - Pan by a tenth of a screen
   * - :kbd:`+` / :kbd:`-`
     - Zoom in / out
   * - :kbd:`Ctrl` + :kbd:`F`
     - Focus the search box
   * - :kbd:`Ctrl` + :kbd:`S`
     - Export the current view
   * - :kbd:`Esc`
     - Close the current dialog or clear the selection

.. tip::

   Dragging horizontally on the ruler pans the view; dragging on a gene track
   selects a region and shows its size.
