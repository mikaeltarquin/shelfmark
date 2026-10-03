# Changelog

Releases of this fork. Images: `ghcr.io/mikaeltarquin/shelfmark:<version>` and `:latest`.

## v1.1.0

### Added

**Saved for later and the download queue**
- **Save books to get later**: bookmark a book, one release, or a combined ebook +
  audiobook pick from search results, library cards and table rows, release lists and the
  combined flow, or straight from the MyAnonamouse hold-back prompt when a download
  doesn't fit. Each user has their own list.
- **Queued or Later**: a book with releases picked is **Queued** and downloads on its own
  once there's room; one without (or one you untick **Queue for download** on) is saved
  for **Later**, to get with **+ Get**. Activity has a tab for each, with counts.
- **Smart automatic downloads**: a queued item goes once its MyAnonamouse torrents fit the
  buffer and the unsatisfied limit (keeping **Unsatisfied Slots to Keep Free**).
  Freeleech (checked live) goes as soon as there's room, even below the target ratio;
  small downloads that barely move the ratio (ebooks) go too; anything else waits until
  the ratio stays at **Keep Ratio At Least** (2.0, under Prowlarr → Saved for Later).
  Never buys upload credit, shows why each item waits, and sends a *Saved book got
  automatically* notification.
- **Downloads wait for an unsatisfied slot instead of failing**: a MyAnonamouse torrent
  that reaches its turn with no slot free, or whose grab MAM refuses at the limit, waits
  in the queue as "Waiting for an unsatisfied slot" and starts on its own once one frees
  up (checked every 5 minutes), longest waiting first. The hold-back prompt offers
  **Queue and wait for a slot** when slots are all that's missing.
- **When unsatisfied slots free up**: the MyAnonamouse panel and header button estimate
  when the next unsatisfied torrent reaches 72 hours seeded ("Next slot in 2:05 · 3 slots
  in the next 6 hours"), from Deluge, qBittorrent or Transmission.

**What you already have, everywhere**
- **Marks on books**: search results, the library's covers and tables, author and series
  rows and the book details mark books **Saved for later** or **Queued**, and
  **Downloading / Downloaded / Failed**, so nothing is saved or got twice.
- **Marks on releases**: the release list (Get) marks each release you downloaded (or are
  downloading, or that failed) and one that's queued or saved for later.
- **Your copies on every book page**: the book details list each library copy (library,
  format, narrator, year, length, size, folder, **Show files**, and a link to open it in
  Audiobookshelf or Calibre-Web), wherever the details open.

**Library browser**
- **All, Authors and Series work alike**: each has a Grid and a Table layout and a format
  filter. Author and series rows open onto their books, and **Owned / Missing / Owned +
  missing** lists the books the metadata provider has that you don't, in line with yours,
  with **Get**.
- **Ebook and Audiobook columns** in the book tables, with a badge per copy: an audiobook
  by its narrator ("Ray Porter"), an ebook by its files ("EPUB, AZW3"). Queued picks show
  in blue and a running download in indigo; a format you lack reads **Missing**. A book
  held in one format and missing the other is one row.
- **A bookmark on every table row** to save the book for later (filled once saved, blue
  once queued).
- **Sorting**: **Author (First Last)**, **Author (Last, First)**, **Book Count**, and
  **Author › Series › Book** by first or last name, each author's books by series, then
  number.

**Activity**
- **Rows open the book**: click a download (in Downloads or History) for the book's
  details and your copies. A failed or cancelled one says why, with **Retry download**;
  History rows have Retry too.
- **Row buttons**: open the release's page at its source (the torrent on MyAnonamouse,
  to grab it by hand when a link has expired), open a finished download in
  Audiobookshelf or Calibre-Web, and save the file to this device.
- **One icon for library links**: the header buttons, the details' "Open in
  Audiobookshelf" and Activity's button share one icon; the Library browser button is a
  database.

**Searching**
- **Retry search** when a release search fails ("indexer 12 did not respond within 30s").

### Fixed
- A library book whose ISBN the metadata provider files under another book opened that
  book's details and searched for it on **Get** ("The Extinction Trials Riddle" for
  *Leviathan Falls*). An ISBN now counts only when the title and author agree;
  otherwise the book is looked up by title.
- Automatic downloads could queue past the MyAnonamouse unsatisfied limit when a torrent
  stopped counting before MAM's own count caught up. Recent snatches now count until it
  does.
- **Clear Completed** in Activity no longer clears failed downloads (cleared items are
  still under History).
- Books in a series whose records name it with and without "The" ("The Expanse",
  "Expanse") fell to the end of the series and lost their number.

## v1.0.2

### Added
- **Title and General search suggestions**: typing in Title search offers book titles from
  Hardcover with their author ("Book Title — by Firstname Lastname"), as Author and
  Series already did. General search suggests books, series and authors together, each
  marked with an icon. Picking a book searches for it, a series opens it in reading order,
  and an author switches to an Author search.
- **MyAnonamouse in the header**: the MyAnonamouse button moves out of the menu to sit
  between Library and Activity, and shows the account's ratio and unsatisfied count
  (amber or red near the limits), refreshed every 5 minutes and after closing the panel.
  It has a mouse icon, and the panel links to your MAM profile and the MAM store.
- **Library links named after where they go**: the header's "Go To Library" buttons now
  read "Audiobookshelf", "Calibre-Web", "Plex"..., worked out from the link (or the
  connected Audiobookshelf server), or set your own under Settings › General.

### Fixed
- The Content / Search by panel on a results page opens below the search bar instead of
  beside it, over the header menus.
- After picking an author or series suggestion, the search box can be edited again.

## v1.0.1

### Added
- **Books released in parts** (GraphicAudio and similar): each part of a book is filed as its
  own book, `Book Title (1 of 5) {GraphicAudio}/Book Title (1 of 5).m4b`, so
  Audiobookshelf creates one item per part and can match it. The part is read from
  MyAnonamouse's series field ("Series Name #1p2") or the release title ("Part 1 of 5", "Pt. 2",
  "(2 of 3)", "[2/3]").
- **Parts are numbered in their series**: part 1 of book 2 gets series position 2.1, part 2
  gets 2.2, and so on (two decimals for ten or more parts), in `{SeriesPosition}` and
  `metadata.opf`, so the parts sort in order in Audiobookshelf.
- **Library browser sorting**: authors sort by First Last (default) or Last, First, by book
  or series count, or recently added, ascending or descending, with a **table view**. Series
  can also sort by author. Choices are remembered in the browser.

### Fixed
- Parts downloaded through the combined (ebook + audiobook) flow went into one folder
  (`Book Title.m4b`, `_1`, `_2`…), because only the book's title was sent and it
  doesn't name the part. The release's title is now used.
- In the combined flow, an ebook downloaded with a part was placed in that part's narrator
  folder. It now goes to its own folder.
- The library browser shows a book downloaded in parts once, at the book's own series
  number, not once per part.
- Blue "added to queue" toasts sometimes stayed on screen when several books were queued
  at once. Every toast now dismisses after a few seconds.

### Upgrading
Parts downloaded before this release stay where they are. To file them per part, delete
the shared folder and download the parts again, or move and renumber them in Audiobookshelf.

## v1.0.0

First release of the fork: Audiobookshelf-friendly file layout (`{Narrator}`, Keep Ebooks
With Audiobooks, several audiobooks per book, `metadata.opf`), MyAnonamouse account tools
(account panel, buying upload credit, auto-buy, projected ratio, buffer check, unsatisfied
limit guard), the Audiobookshelf library check, the Libraries settings group, and the
library browser (All, Authors, Series, "Not in your library", + Get on every card). See
[About this fork](readme.md#-about-this-fork).
