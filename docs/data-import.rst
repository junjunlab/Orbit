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
     - Needs a ``.bai`` next to it. Coverage is computed on the fly.
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

bedGraph
--------

Plain text, four columns. Convenient for small, hand-made tracks; a genome-wide
file will cost memory, so prefer bigWig above a few hundred megabytes.

BAM
---

Orbit needs both ``sample.bam`` and ``sample.bam.bai`` in the same directory.
Coverage is computed from the reads in the visible window only, which keeps
memory flat but means the first draw of a new region takes a moment.

GTF / GFF3
----------

Imported annotations become a normal gene track: expandable transcripts,
strand colours, labels. Transcript and CDS features are preserved, so a GTF
exported from StringTie or Ensembl looks the way you expect.

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

Imported files are referenced in place, not copied. If you move or delete the
original, the track breaks on the next launch. Paths are stored in the session,
so reopening Orbit restores the tracks you had.
