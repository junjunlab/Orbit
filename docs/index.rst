Orbit
=====

Orbit is a desktop genome browser for people who need to look at a locus *now*.
It opens as a native window, needs no Java and no separately managed server.
Annotations work offline; sequence requires a local source or access to the
configured remote reference. In-memory remote caches are not a persistent
offline genome download.

RefSeq annotations are compiled into a binary index at build time, and sequence
is read from UCSC 2bit files — from disk or over HTTP Range — so a whole
chromosome of genes loads in milliseconds and the installer stays around 70 MB
of annotation instead of carrying a 3 GB genome.

.. image:: screenshot.png
   :class: orbit-hero
   :alt: The Orbit window showing three loci side by side with signal tracks

What you get
------------

* A native Qt window (no browser tab, no local server to babysit)
* 18 assemblies across 9 species, annotation bundled
* Gene models with transcript expansion, cytobands, GC and sequence tracks
* Right-click a gene model for the transcript, exon/CDS/UTR fragment and every
  intron under the pointer, with coordinates and lengths
* BAM and SAM as three labelled rows — coverage, splice junctions, alignments —
  with the four IGV display modes, wheel scrolling through every read, and a
  visibility window chosen from the experiment type
* bigWig and bedGraph signal tracks, multi-sample overlays
* Copy-number SEG files: one track per sample, or a cohort heatmap
* Import your own bigWig, bedGraph, SEG, BAM, GTF or FASTA at runtime
* A non-model organism works without a catalog entry: pick the empty **Custom**
  assembly and import your genome FASTA plus its GFF3
* Split view, deep links, PNG / SVG / PDF export

.. note::

   This documentation is available in English and Chinese. Use the language
   selector at the top of the left sidebar to switch between
   ``English`` and ``简体中文``. The Chinese translation lives at
   ``/zh-cn/latest/`` on the same site.

.. toctree::
   :maxdepth: 2
   :caption: Getting started

   installation
   quickstart

.. toctree::
   :maxdepth: 2
   :caption: Using Orbit

   interface
   navigation
   data-import
   sequence
   data-export
   assemblies

.. toctree::
   :maxdepth: 2
   :caption: Under the hood

   how-it-works
   building
   faq

Indices
-------

* :ref:`genindex`
* :ref:`search`
