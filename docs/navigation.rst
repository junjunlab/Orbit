Navigation
==========

Moving around a genome is the part you do most, so Orbit tries to make every
route to a locus one action long.

Search syntax
-------------

The search box accepts several forms and figures out which one you meant:

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Input
     - Result
   * - ``TP53``
     - Jumps to the gene, case-insensitive
   * - ``chr17:7,668,402-7,687,550``
     - That interval on chr17
   * - ``chr17:7668402-7687550``
     - Same, without thousands separators
   * - ``7,668,402-7,687,550``
     - Uses the current chromosome
   * - ``chr17:7,668,402``
     - A single base, shown with a 50 bp flank
   * - ``chr17``
     - The whole chromosome

If a gene symbol matches several genes, the first hit is used and a list of
alternatives is offered. Press :kbd:`Enter` again to cycle through them.

Zooming and panning
-------------------

* Mouse wheel zooms around the cursor
* Dragging on the ruler pans; dragging on a gene selects a range
* :kbd:`+` / :kbd:`-` zoom around the centre
* The zoom level is shown as base pairs per pixel, which is the honest measure
  of how much detail you are actually seeing

There is a hard limit at one base per pixel. Beyond that the sequence track
takes over — it draws coloured bases instead of pretending to have more
resolution.

Split view
----------

Split view shows up to four independent loci at once, each with its own
chromosome, coordinates and selection. It is the fastest way to compare the
same gene across samples, or to check that an event really is where you think
it is.

* Choose *2*, *3* or *4* panes from the toolbar
* Each pane keeps its own search state; :kbd:`Ctrl` + :kbd:`1` … :kbd:`4`
  focuses a pane
* Tracks are shared — load a bigWig once and it appears in every pane
* The whole-genome overview is not split; it follows the focused pane

Deep links
----------

Every view has a URL you can paste into a notebook or a chat:

.. code-block:: text

   http://127.0.0.1:8765/?db=hg38&locus=chr17:7,668,402-7,687,550

Parameters:

.. list-table::
   :header-rows: 1
   :widths: 18 82

   * - Key
     - Meaning
   * - ``db``
     - Assembly id, for example ``hg38`` or ``mm39``
   * - ``locus``
     - A locus in any of the search-box forms
   * - ``tracks``
     - Comma-separated track names to enable

When Orbit runs as a desktop window the address bar is not visible, but the
link is still accepted: launch with ``--browser`` and the page reads the
query string, or paste the locus part into the search box.

Transcript expansion
--------------------

Click any gene to expand it into its transcripts. Expanded genes show exons,
introns, CDS thickness, and the coding direction; the row grows from 32 to
54 pixels and the label is drawn on top of the feature when there is no room
beside it.

* Click again to collapse
* :kbd:`Shift` + click expands every gene in the window
* The expanded set is remembered across sessions

The whole-genome overview
-------------------------

The overview at the bottom lists every primary chromosome as a horizontal bar
whose length is proportional to the chromosome size, with the current window
marked in colour. It starts collapsed as a single row for the current
chromosome; press the chevron to expand all 25 rows. Clicking a bar navigates
to that chromosome.
