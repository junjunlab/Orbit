Assemblies
==========

Orbit bundles annotation for 18 assemblies across 9 species. Sequence is not
bundled — it is streamed from UCSC on demand, which is what keeps the download
small.

Bundled assemblies
------------------

.. list-table::
   :header-rows: 1
   :widths: 30 20 20 30

   * - Species
     - Current
     - Previous
     - Source
   * - Human
     - ``hg38``
     - ``hg19``
     - UCSC refGene
   * - Mouse
     - ``mm39``
     - ``mm10``
     - UCSC refGene
   * - Rat
     - ``rn7``
     - ``rn6``
     - UCSC refGene
   * - Zebrafish
     - ``danRer11``
     - ``danRer10``
     - UCSC refGene
   * - Fly
     - ``dm6``
     - ``dm3``
     - UCSC refGene
   * - Worm
     - ``ce11``
     - ``ce10``
     - UCSC refGene
   * - Yeast
     - ``sacCer3``
     - ``sacCer2``
     - UCSC refGene
   * - Frog
     - ``xenTro10``
     - ``xenTro9``
     - UCSC refGene
   * - Chicken
     - ``galGal6``
     - ``galGal5``
     - UCSC refGene

Each assembly carries gene models, cytobands, chromosome sizes and the primary
chromosome order used by the overview panel.

How sequence is fetched
-----------------------

Every assembly in ``data/catalog.json`` records a ``twoBitURL`` pointing at the
UCSC 2bit file. When you navigate, Orbit issues an HTTP Range request for just
the bytes covering the window and decodes them locally.

* First visit to a chromosome: about one second
* Subsequent moves within it: about 0.3 seconds
* Nothing is written to disk; the range cache is in memory and per session

If the network is unavailable, the sequence and GC tracks go grey and
everything else keeps working.

Offline mode
------------

Set ``ORBIT_OFFLINE=1`` before launching to forbid network access. Combined
with a local FASTA or 2bit, this gives a fully air-gapped browser::

   set ORBIT_OFFLINE=1
   Orbit.exe

With no local sequence the GC and sequence tracks stay disabled, but genes,
cytobands, search and imported tracks are unaffected.

Adding your own assembly
------------------------

Edit ``data/catalog.json`` and add an entry alongside the existing ones:

.. code-block:: json

   {
     "id": "myAssembly",
     "organism": "My organism",
     "scientificName": "Genus species",
     "chroms": {"chr1": 248956422, "chr2": 242193529},
     "primary": ["chr1", "chr2"],
     "twoBitURL": "https://example.org/my.2bit",
     "ann": "ann/myAssembly"
   }

Then place ``genes.igvbin`` and ``cytoband.json`` under
``data/ann/myAssembly/``. The binary index is produced by the build scripts in
``build/``; see :doc:`how-it-works` for the format.

Restart Orbit and the assembly appears in the selector. Nothing else needs to
change — the frontend reads the catalog, not a hard-coded list.
