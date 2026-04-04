# NOTICE -- Unofficial Firefox Modification

## Disclaimer

This directory contains an **unofficial modification** of Mozilla Firefox that
adds DRM/EME (Encrypted Media Extensions) debugging tools to the Firefox
Developer Tools.

**This software is NOT endorsed by, affiliated with, or supported by Mozilla.**

## What This Modification Does

This modification adds:

1. A "DRM" panel to Firefox Developer Tools for inspecting EME key systems,
   media key sessions, and DRM-related events.
2. A preference (`media.eme.capture-allowed`) that, when enabled, bypasses the
   W3C EME restriction on capturing protected media streams via
   `captureStream()` and `canvas.drawImage()`.
3. MCP (Model Context Protocol) tools for programmatic DRM diagnostics.

## Security and Legal Implications

The DRM media capture bypass has significant security and legal implications:

- **Legal risk**: Circumventing technological protection measures may violate
  laws such as the Digital Millennium Copyright Act (DMCA, 17 U.S.C. 1201),
  the EU Copyright Directive (Article 6), or equivalent legislation in other
  jurisdictions. Users are solely responsible for ensuring their use complies
  with applicable law.
- **Content protection**: The `media.eme.capture-allowed` preference disables
  a content protection mechanism defined by the W3C EME specification. Enabling
  it allows unprotected access to DRM-decrypted media frames and streams.
- **Not for production**: This modification is intended **only** for developer
  debugging and testing of EME implementations. It must not be used to
  circumvent digital rights management for unauthorized copying or
  redistribution of copyrighted content.

## Intended Use

This tooling is designed for:

- Browser engine developers debugging EME integration issues.
- Web developers testing their EME-based media player implementations.
- Security researchers analyzing DRM behavior (subject to applicable law).

It is **not** designed for, and must not be used for:

- Circumventing DRM to copy or redistribute copyrighted content.
- Production deployment or distribution to end users.
- Any purpose that violates applicable copyright or anti-circumvention laws.

## No Warranty

This modification is provided "as is", without warranty of any kind, express or
implied. The authors assume no liability for any damages arising from the use of
this software.
