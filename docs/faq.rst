FAQ and troubleshooting
===========================

The gene does not expand when I click it
--------------------------------------------

Click the small **+** beside the gene, not the gene body. The body selects the
gene and updates its details. Use **−** to collapse, or the gear beside the
gene track for **Expand all / Collapse all**. Imported gene tracks have their
own gear. See the before/after images in :doc:`navigation`.

I imported FASTA but see no letters
---------------------------------------

Enable that exact imported track and zoom to a narrow interval, for example
``chr7:5,529,627-5,529,685`` on hg38. At a wide scale the track only shows a
zoom-in hint. Letters need about 8 pixels per base. Check the assembly and
chromosome header if it is still empty. The verified examples and screenshots
are in :doc:`sequence`.

ACTB shows CAT instead of ATG
---------------------------------

ACTB is on the negative strand. The default reference row reads CAT at its
start boundary. Flip the imported sequence row, then read its complementary
letters right to left (coding 5′→3′) to get ATG. Flip does not reverse genomic
coordinates or change the gene's strand. See :doc:`sequence`.

Why do I see several M and stop symbols?
--------------------------------------------

Aa shows three genomic reading frames, not a splice-aware annotated protein.
Incidental ATG and stops are normal. Choose a transcript, inspect its CDS
boundary and strand, and use the correct genetic code. Green M is an ATG
highlight, not proof of initiation. The genetic-code table is in :doc:`sequence`.

Built-in sequence or GC is unavailable after FASTA import
-------------------------------------------------------------

Imported FASTA is an independent track. Built-in sequence/GC and backend motif
or BAM mismatch operations use a local matching 2bit, or the configured remote
2bit when permitted. Check ``data/genomes/<assembly>.2bit``, network access,
``ORBIT_OFFLINE`` and the assembly's ``twoBitURL``. Local FASTA alone does not
replace this backend reference.

The first visit or import takes time
----------------------------------------

A remote reference needs an index/range request; response time depends on your
network and reference file. BAM is scanned into an interval index during
import, and gzip FASTA is decompressed into memory. Large files therefore need
both time and RAM; this is not guaranteed to be a fixed one-second operation.
For large signal data use indexed bigWig rather than genome-wide bedGraph.

My BAM looks empty or incomplete
------------------------------------

Choose the correct assembly and a chromosome that actually has reads — a
``chr1`` BAM shows nothing on ``chr2``. Check the parent BAM switch and the
Alignments switch under it. Coverage, junctions and alignments are hidden beyond
the visibility window (30 kb standard, 300 kb RNA-seq, 1000 kb third generation),
so a whole-chromosome view is expected to be empty; the row says so. Nothing is
sampled or truncated: every read in the window is returned, and rows that do not
fit are scrolled. If the file has no usable ``.bai``, the first load builds one —
watch the progress message instead of assuming the import failed.

Why do two panels have different coordinate scales?
-------------------------------------------------------

Each panel has its own interval and zoom. Shared horizontal screen position
is not a common genomic coordinate, and one panel is not one sample. Use its
header input to search a gene, click its header to select it, and use × to
close it. The program supports up to five panels. See :doc:`navigation`.

Will tracks and preferences return next launch?
---------------------------------------------------

Imports are session-scoped: a launch opens nothing, and the imported files
reappear in the sidebar only after you import them again in that session. ``IGV_RESTORE_LOADED=1`` enables backend restoration of
stored imports, but a restored row can still be unchecked.
The frontend deliberately starts fresh for many preferences; language is
stored separately. Do not rely on an old expanded-gene set returning next time.
Keep the original research files. Removing a track can remove the imported copy.

Avoid deleting the entire Orbit user-data directory to reset a colour: that
directory can contain imported research files. Prefer the specific reset
control in the relevant settings panel.

Does Orbit work offline?
----------------------------

Bundled annotations and imported tracks can work offline. Imported FASTA can
show its own sequence offline. A local matching 2bit is needed for offline
built-in reference operations. Remote sequence caches are in memory, not a
persistent download of every chromosome you have visited. ``ORBIT_OFFLINE=1``
disables the remote-reference fallback.

The PDF is not editable
---------------------------

Normally PDF uses vector primitives and an embedded system font. If the font
cannot be loaded, the program reports that it exported a raster fallback.
Try SVG, or configure a supported system font with ``IGV_FONT`` and export
again. Do not infer vector content solely from the .pdf extension.

Windows or macOS blocks startup
-----------------------------------

Only bypass a warning for an installer whose origin you trust. The Windows
build may be unsigned; inspect the publisher/source before using **More info →
Run anyway**. The macOS build may be unnotarized. Confirm the downloaded
application before changing quarantine settings; do not disable platform
security globally.

The application window stays blank
--------------------------------------

Inspect ``%LOCALAPPDATA%/Orbit/orbit.log`` on Windows. If a local port conflict
is reported, launch with a different port such as ``--port 8766``. Running two
servers does not isolate imported files when they share the same data folder;
use a separate ``--data`` directory if you need isolated test data.
