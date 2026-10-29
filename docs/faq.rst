FAQ
===

The sequence and GC tracks are grey
-----------------------------------

Those tracks need sequence, and sequence is fetched from UCSC. Check that:

* the machine has network access,
* ``ORBIT_OFFLINE`` is not set to ``1``,
* the assembly has a ``twoBitURL`` in ``data/catalog.json``.

Genes, cytobands, search and imported tracks do not need sequence and keep
working either way.

Loading a locus is slow the first time
--------------------------------------

That is the range request fetching the 2bit index and the blocks for the
window. The first visit to a chromosome takes about a second; moving within it
afterwards is roughly 0.3 seconds. If every move is slow, the machine is
probably re-resolving DNS — try a local FASTA.

macOS says the app is damaged
-----------------------------

The build is not notarized, so Gatekeeper quarantines it. Run once::

   xattr -dr com.apple.quarantine /Applications/Orbit.app

Windows SmartScreen blocked the installer
-----------------------------------------

The installer is not code-signed. Choose **More info → Run anyway**.

The window opens but stays blank
--------------------------------

Check ``orbit.log`` in the settings directory (see :doc:`installation`). A
blank window almost always means the backend failed to start — usually a port
already in use. Launch with ``--port 8766`` and see whether it comes up.

Where are my settings stored?
-----------------------------

``%LOCALAPPDATA%\Orbit`` on Windows, ``~/Library/Application Support/Orbit`` on
macOS. Delete the folder to reset everything; the app recreates it on next
launch. Set ``ORBIT_HOME`` to use a different location.

Why does a gene label overlap the feature?
------------------------------------------

When the name does not fit beside the feature, it is drawn on top of it with a
translucent background rather than being truncated to ``NM_00…``. That is
deliberate: a shortened accession is worse than a slightly busy label.

Can I use my own genome?
------------------------

Yes — add an entry to ``data/catalog.json`` and a local FASTA, as described in
:doc:`assemblies`. Any assembly UCSC hosts also works by pointing
``twoBitURL`` at its 2bit file.

Why is there no batch export?
-----------------------------

Split view covers most of the need: up to four loci in one canvas, one export.
A real batch mode would need a separate renderer that does not depend on the
window, which is a larger change than it looks.

Can I run two instances at once?
--------------------------------

Yes, with different ports and different state directories::

   set ORBIT_HOME=%TEMP%\orbit-b
   Orbit.exe --port 8766

Does it work offline?
---------------------

With a local FASTA or 2bit, yes. Set ``ORBIT_OFFLINE=1`` to make sure nothing
tries to reach the network.
