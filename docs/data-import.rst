Importing data
==============

Orbit reads the common genomics formats directly. Drag a file onto the window,
or press the **Import** button in the toolbar. The format is chosen by
extension.

Supported formats
-----------------

.. list-table::
   :header-rows: 1
   :widths: 16 26 58

   * - Format
     - Extension
     - Notes
   * - bigWig
     - ``.bw`` ``.bigWig``
     - Random access, no indexing step. Best choice for signal.
   * - bedGraph
     - ``.bedGraph`` ``.bdg``
     - Loaded into memory; fine up to a few hundred MB.
   * - BAM
     - ``.bam``
     - Coverage and stacked reads are computed from the file directly; a ``.bai`` is optional.
   * - GTF / GFF3
     - ``.gtf`` ``.gff`` ``.gff3``
     - Becomes a gene track; UTR and CDS features are kept.
   * - FASTA
     - ``.fa`` ``.fasta``
     - Registers the file as a local sequence source for the current assembly.

bigWig
------

The recommended format. Orbit parses the index itself, so there is no
``bigWigToBedGraph`` step and no conversion. Multi-sample overlays work best
when the files share a coordinate system.

.. code-block:: text

   Import → select SRR1234.bw

The track appears immediately with autoscale on. Open its label to pin the
range if you want several samples to share one scale.

.. figure:: examples/import-bigwig.png
   :align: center
   :width: 100%

   A ribo-seq ``.bw`` track imported onto hg38. The signal is added to the
   signal panel with autoscale on, and its label (``Scr_R1_IP``) appears in the
   left sidebar.

bedGraph
--------

Plain text, four columns (``chrom  start  end  value``). Convenient for small,
hand-made tracks; a genome-wide file will cost memory, so prefer bigWig above a
few hundred megabytes. Orbit renders bedGraph exactly like bigWig — same signal
panel, same autoscale, same colour controls.

.. code-block:: text

   Import → select sample.bedGraph

.. figure:: examples/import-bedgraph.png
   :align: center
   :width: 100%

   A four-column ``.bedGraph`` file on hg38, rendered identically to a bigWig
   signal track. Both go through the same drawing path, so you can mix ``.bw``
   and ``.bedGraph`` in one view.

BAM
---

Orbit reads the alignments straight from the ``.bam`` — there is no separate
indexing step and a ``.bai`` is optional. Coverage and the stacked reads are
computed from the reads in the visible window only, which keeps memory flat but
means the first draw of a new region takes a moment.

.. code-block:: text

   Import → select sample.bam

Each BAM produces two linked views: a **coverage** track (the blue area) and an
**alignment** track (the grey stacked reads). Toggle them independently from the
track label.

.. figure:: examples/import-bam.png
   :align: center
   :width: 100%

   A BAM imported onto hg38, shown at ``chr1:11.79–11.81 Mb``. The blue track is
   read coverage; the striped block below it is the stacked alignments. The
   bundled RefSeq track (``MTHFR``, ``CLCN6``) sits above for context.

GTF / GFF3
----------

Imported annotations become a normal gene track: expandable transcripts,
strand colours, labels. Transcript and CDS features are preserved, so a GTF
exported from StringTie or Ensembl looks the way you expect. Chromosome naming
is reconciled automatically, so Ensembl-style ``1`` / ``I`` maps onto UCSC-style
``chr1`` / ``chrI``.

.. code-block:: text

   Import → select annotation.gtf

.. figure:: examples/import-gtf.png
   :align: center
   :width: 100%

   A yeast GTF (``representative_transcripts.gtf``) imported onto sacCer3 and
   shown directly under the bundled RefSeq track. Gene names and strand arrows
   are drawn for both.

.. note::

   Imported annotations are not converted to the built-in binary format. They
   are read on load, which is fine for a few hundred thousand features but
   slower than the bundled RefSeq index.

FASTA
-----

Loading a FASTA registers it as the local sequence source for the assembly.
This is how you use Orbit fully offline, or work with an assembly that UCSC
does not host.

.. code-block:: text

   Import → select genome.fa

Large FASTA files are memory-mapped, so a 3 GB genome does not need 3 GB of
RAM — but the first access to a chromosome still costs a disk read.

Where imported tracks live
--------------------------

Importing copies the file into Orbit's per-user data directory
(``data/loaded``, or ``%LOCALAPPDATA%/Orbit/loaded`` when the install
directory is read-only), so the original file is no longer needed after import.
Imported tracks are session-scoped by default: set ``IGV_RESTORE_LOADED=1`` to
restore them automatically on the next launch.
