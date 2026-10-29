Installation
============

Pick the package for your platform from the `Releases page
<https://github.com/junjunlab/Orbit/releases>`_.

.. list-table::
   :header-rows: 1
   :widths: 34 40 12

   * - Platform
     - File
     - Size
   * - Windows 10/11 x64
     - ``Orbit-1.0.0-Windows-x64-Setup.exe``
     - ~150 MB
   * - macOS, Apple Silicon
     - ``Orbit-1.0.0-macOS-arm64.dmg``
     - ~244 MB
   * - macOS, Intel
     - ``Orbit-1.0.0-macOS-x86_64.dmg``
     - ~253 MB

Windows
-------

Run the installer. It is a **per-user** installation: no administrator rights
are required and nothing is written outside your profile.

* Program files: ``%LOCALAPPDATA%\Programs\Orbit``
* Settings and logs: ``%LOCALAPPDATA%\Orbit``

The installer offers a desktop shortcut (off by default) and can launch Orbit
when it finishes.

.. note::

   The executable is not code-signed, so Windows SmartScreen may show
   *"Windows protected your PC"*. Choose **More info → Run anyway**.

macOS
-----

Open the ``.dmg`` and drag **Orbit** into *Applications*.

The build is ad-hoc signed but **not notarized**, so the first launch is
blocked by Gatekeeper. Either:

* right-click (or Control-click) the app and choose **Open**, then confirm, or
* run once in Terminal::

     xattr -dr com.apple.quarantine /Applications/Orbit.app

If macOS reports the app is *damaged and can't be opened*, the quarantine
attribute is the cause — the ``xattr`` command above fixes it.

Command line
------------

The frozen build accepts the same options as the Python module, which is handy
for scripts and for running several instances side by side.

.. list-table::
   :header-rows: 1
   :widths: 26 74

   * - Option
     - Meaning
   * - ``--data PATH``
     - Use another data directory instead of the bundled one
   * - ``--port N``
     - Listen on a different port (default ``8765``)
   * - ``--host HOST``
     - Bind address (default ``127.0.0.1``)
   * - ``--browser``
     - Open the system browser instead of the native window
   * - ``--no-browser``
     - Headless: serve the API only
   * - ``--debug``
     - Verbose logging, plus JavaScript console output from the window

Example — two instances, separate state, different ports::

   set ORBIT_HOME=%TEMP%\orbit-b
   Orbit.exe --port 8766

``ORBIT_HOME`` moves the settings and cache directory, so instances do not
share preferences.

Where things are stored
-----------------------

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - What
     - Location
   * - Preferences, session, Qt cache
     - ``%LOCALAPPDATA%\Orbit`` (Windows), ``~/Library/Application Support/Orbit`` (macOS)
   * - Application log
     - ``orbit.log`` in the directory above
   * - Annotation and assemblies
     - ``data/`` next to the executable

Uninstalling
------------

Use *Add or remove programs* on Windows, or move the app to the Bin on macOS.
User data in ``%LOCALAPPDATA%\Orbit`` is left in place; delete it manually if
you want a clean slate.
