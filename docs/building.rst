Building from source
====================

Running it
----------

Orbit needs Python 3.10 or newer and PySide6. Everything else is standard
library.

.. code-block:: bash

   git clone https://github.com/junjunlab/Orbit.git
   cd Orbit
   pip install -r requirements.txt
   python -m igvlocal                 # native window
   python -m igvlocal --browser       # fall back to the system browser
   python -m igvlocal --no-browser    # API only, for scripting

Freezing
--------

``build/make_exe.py`` wraps PyInstaller and is the single entry point for both
platforms.

.. code-block:: bash

   python build/make_exe.py --no-genomes --windowed

* ``--no-genomes`` skips the ``*.2bit`` files, so the bundle carries annotation
  only and sequence comes from UCSC. This is what the installers use.
* ``--windowed`` builds a GUI executable with no console window.
* Without either flag you get a console build with local sequence — useful for
  debugging.

The script handles the platform differences that PyInstaller does not:

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Difference
     - Handling
   * - ``--add-data`` separator
     - ``;`` on Windows, ``:`` on macOS
   * - Output layout
     - ``dist/Orbit/`` on Windows, ``dist/Orbit.app`` on macOS
   * - Data location
     - ``data/`` next to the executable, which is ``Contents/MacOS`` inside the bundle
   * - Bundle id
     - ``--osx-bundle-identifier`` is passed on macOS only

Windows installer
-----------------

Requires `Inno Setup 6 <https://jrsoftware.org/isinfo.php>`_.

.. code-block:: bat

   ISCC.exe installer\orbit.iss

Produces ``dist\installer\Orbit-1.0.1-Windows-x64-Setup.exe``. The script is a
per-user install (``PrivilegesRequired=lowest``), which avoids the UAC prompt
and lets the app write to its own data directory.

.. note::

   Inno Setup does not ship a Simplified Chinese language file, so
   ``installer/ChineseSimplified.isl`` is kept in the repository and referenced
   by a relative path. Without it the compiler fails with *"Couldn't open
   include file"*.

macOS disk image
----------------

.. code-block:: bash

   bash installer/make_dmg.sh

The script ad-hoc signs the bundle, clears extended attributes, stages the app
with an ``/Applications`` symlink, and calls ``hdiutil``. Ad-hoc signing is not
optional: on Apple Silicon an unsigned arm64 binary is killed on launch.

Shipping without the Gatekeeper warning needs an Apple Developer certificate
and a notarization step, neither of which the project has.

Continuous integration
----------------------

``.github/workflows/build.yml`` builds all three packages on every tag.

.. list-table::
   :header-rows: 1
   :widths: 22 20 58

   * - Job
     - Runner
     - Produces
   * - Windows-x64
     - ``windows-latest``
     - Inno Setup installer
   * - macOS-arm64
     - ``macos-15``
     - arm64 disk image
   * - macOS-x64
     - ``macos-15-intel``
     - Intel disk image
   * - Publish release
     - ``ubuntu-latest``
     - Collects all three and attaches them to the release

The release step is a separate job on purpose. Running it inside the matrix
means three jobs publish concurrently, which duplicates the release notes and
races on the same assets.

.. tip::

   Runner labels are easy to get wrong. ``macos-15`` is Apple Silicon,
   ``macos-15-intel`` is Intel, and ``macos-15-arm64`` is not a label at all —
   a job using it queues forever.

Releasing
---------

.. code-block:: bash

   git tag v1.0.1
   git push --tags

The tag push triggers the build and attaches the three packages to a new
release. Nothing is published for ordinary pushes to ``main``.

Building the documentation
--------------------------

.. code-block:: bash

   pip install -r docs/requirements.txt
   sphinx-build -b html docs docs/_build/html

The English build is the source; Chinese comes from the gettext catalogues in
``docs/locale/zh_CN/LC_MESSAGES``.

To refresh the catalogues after editing a page:

.. code-block:: bash

   sphinx-build -b gettext docs docs/_build/gettext
   sphinx-intl update -p docs/_build/gettext -l zh_CN

Then translate the new ``msgid`` entries and rebuild with ``-D language=zh_CN``.
