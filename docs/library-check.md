# Library Check

Shelfmark can mark search results you already own, so you do not download a second copy
of a book that is already on your shelf. The check is read only and off by default.

## Calibre

Point Shelfmark at the `metadata.db` of a Calibre library (Calibre, Calibre-Web,
Calibre-Web-Automated, anything that keeps the standard Calibre format) and it reads the
database directly. No HTTP call, no API token, and nothing is ever written back.

1. Mount the library folder into the container read only, for example
   `/path/to/calibre-library:/calibre-library:ro`. Mount the folder rather than the file
   so the `-wal` and `-shm` sidecars are visible, otherwise a library that is being
   written to can read as out of date.
2. In **Settings, Libraries, Calibre**, turn on **Mark books already in your Calibre library**.
3. Leave **Calibre metadata.db path** at `/calibre-library/metadata.db` unless you mounted
   it somewhere else.
4. Press **Test Calibre library**. It reports how many books it indexed.

A result that matches the library then carries an **In library** badge in the card, list
and compact views, and in the details dialog.

## Audiobookshelf

Shelfmark reads your Audiobookshelf book libraries through its API. Nothing is written back.

1. In Audiobookshelf, open **Settings > API Keys** and create a key for a user that can
   see the libraries you want checked.
2. In Shelfmark's **Settings, Libraries, Audiobookshelf**, turn on **Mark books already
   in your Audiobookshelf library**, and fill in **Audiobookshelf URL** (as Shelfmark reaches it, e.g.
   `http://audiobookshelf:80`) and **Audiobookshelf API key**.
3. Press **Test Audiobookshelf library**. It reports how many items it indexed and fills
   **Audiobookshelf libraries** with the server's book libraries by name. Tick the ones
   to check, or keep **All book libraries**, which also covers libraries added later.
   Podcast libraries are never read. (As an environment variable, `ABS_LIBRARY_IDS`
   takes comma-separated library IDs.)

An item counts for the formats it holds: the audiobook when it has audio files, the
ebook when it has an ebook file, and both for an item that holds both (the folders
**Keep Ebooks With Audiobooks** makes). With more than one format checked, the badge says
which you have ("Have audiobook", "Have ebook + audio"), and its tooltip names the library.

In the audiobook release list, a release whose narrator matches an audiobook of the book
you already have is marked **Narration in library**, so a narration you don't have yet
stands out.

Matching uses the same rules as Calibre, below. Audiobookshelf has no cheap change token,
so its items are re-read at most every ten minutes.

## Browsing the library

With a library connected, admins get a **Library** button in the header. It shows every
book in the connected libraries as a cover grid, with a filter (title, author, series or
narrator), a format filter (ebook, audiobook, or both) and sorting by title, author or
recently added. A book held by both libraries, say the ebook in Calibre and the audiobook
in Audiobookshelf, is one book with both format badges.

The **Authors** and **Series** tabs list every author and series with a count. Authors sort
by **First Last** (the default), **Last, First** (which also shows names that way), number
of books or series, or most recently added, ascending or descending, and show as cards or
as a **table** (click a column heading to sort by it). These choices are remembered in
the browser. "Weir, Andy" and "Andy Weir" count as the same author. Series sort by name,
by author (First Last or Last, First), by number of books or by most recently added, in
either direction. An author's
page shows all their books, or groups them by series (**All books** / **By series**); a
series page shows the books in reading order with their numbers. Clicking an author or
series name anywhere opens its page, and each page has its own address
(`/library/authors/<name>`, `/library/series/<name>`), so it can be bookmarked.

Books you own work like search results: hover a card for **details** and the
**Hardcover lists** button, and **+ Get** underneath finds releases, in the format picked
in the header (or both, in combined mode). Use it to get the format you're missing, a
better copy, or another narrator's version; releases whose narrator you already own are
marked. The card looks the book up with the metadata provider the first time it's
hovered (by ISBN, else title and author), and the answer is remembered.

Below the books you own, author and series pages list what is **Not in your library**:
the books the metadata provider knows for that author or series, minus the ones you have.
Pick **Any format**, **Ebook** or **Audiobook**: under Audiobook, a book you own only as
an ebook still shows (with a "Have ebook" badge). Picking Ebook or Audiobook also switches
the header's content type, so **Get** on a missing book finds releases in that format;
it opens the usual release (or request) flow. Series need a provider that can list a
series (Hardcover); with Hardcover an author is looked up by their Hardcover id, so the
list is their own books. Up to 200 books are listed per author or series.

Covers come from the library that holds the book. Calibre's covers live in each book's
folder, so they show when the whole Calibre library is mounted, not just `metadata.db`.
A book without a library cover gets one from the metadata provider (Hardcover, for
example), looked up by ISBN or by title and author, the way search results show them.
Found covers are remembered in `library_covers.json` in the config folder; a book with no
cover anywhere is looked up again after a week.

## How a match is decided

In order of confidence:

1. An external id the metadata provider and the library agree on.
2. An ISBN, compared in both ISBN-10 and ISBN-13 form.
3. Fuzzy title tokens plus the author surname, the same rule the rest of the app uses for
   book matching.

## Behaviour worth knowing

- **It fails open.** If the database cannot be read, Shelfmark logs a warning, reuses the
  last successful read if it has one, and otherwise treats the book as not owned. A broken
  path degrades the badge, it never blocks a search.
- **Results are cached** for ten minutes, and refreshed early when the database file
  changes, so a large library costs one read rather than one per search.
- **Calibre is ebooks only.** A Calibre library holds ebooks, so it answers for ebooks;
  Audiobookshelf answers for both. The provider interface in `shelfmark/core/library_providers/` takes more libraries: add a
  module with the `LibraryProvider` shape and list it in `all_providers()`. Nothing above
  that function knows which libraries exist.
