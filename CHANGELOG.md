# Changelog

Releases of this fork. Images: `ghcr.io/mikaeltarquin/shelfmark:<version>` and `:latest`.

## Unreleased

### Fixed

- **MyAnonamouse downloads no longer run past the unsatisfied limit when MAM's count
  lags.** MAM only counts a torrent once its tracker hears from the client, so while it
  rejected the client's announces (an unregistered IP, say) Shelfmark went on grabbing.
  Now each grab also counts the MAM torrents in the torrent client, and MAM downloads wait
  while MAM rejects the client's announces or can't be read.
- **MAM's day-long download freeze is respected.** Read from a refused download (or
  entered under **Download pause** in the account panel), it holds MAM downloads until it
  lifts, with a countdown in the top bar.
- qBittorrent's MyAnonamouse torrents with no working tracker are no longer left out of
  the slot timing.
- **A torrent with no progress for 5 minutes waits in the torrent client instead of being
  cancelled.** It was left downloading there with nothing to pick up the files, and shown
  as Cancelled. Now it waits on **Activity → Queued** ("Waiting in Deluge: no progress…")
  and carries on once the client shows it moving or finished.
- **A retry finds its torrent in the client by its hash**, without downloading the
  .torrent again, so it works while MyAnonamouse has frozen downloads. The hash is kept
  from when the torrent was handed to the client.

## v1.2.0

### Added

**A Sonarr/Radarr-style layout**
- **Left navigation and a search bar that's always there**: Search, Library, Activity
  (Queued, Downloads, Requests, History), Wanted, Settings and System, each a page with
  its own address. The open section lists its pages, with counts. On a phone it's a menu.
- **Tables for Activity, Wanted and the Library**, with sortable columns.
- **Settings is a page**, its tabs grouped into sections (Indexers, Download Clients with
  Torrent and Usenet tabs, Libraries, Notifications…). **System** has the version,
  health and support links.
- **A theme button** in the top bar: Light, Dark or Auto.
- Links, images and install commands point at this fork.

**The download queue**
- **Activity → Queued is everything waiting, in order**: **Up next** (downloads waiting
  to start, such as a MyAnonamouse torrent waiting for an unsatisfied slot) and then
  **Waiting for room** (saved picks), numbered in the order they go. Drag a row, or use
  its arrows, to reorder either list.
- **Each saved pick shows** its releases (one per line, with the narrator and a link to
  the release on MyAnonamouse), what it's **Waiting for**, when it was **Last checked**
  and a countdown to the **Next check**.
- **Each release goes on its own**: a freeleech torrent or a small ebook downloads as soon
  as there's room, instead of waiting for a big audiobook picked with it. An ebook that
  goes first is still filed with its audiobooks.
- **Wanted** (formerly Later) has **Choose releases** on each book; once you pick, the book
  moves to the queue.
- **Titles and covers on Queued and Wanted open the book's details.**

**Activity**
- **Finished downloads go straight to History**, and History is kept (it can't be
  cleared). Clear Completed is gone.
- **Narrators** are listed under the author in Queued, Downloads and History, so two
  recordings of a book can be told apart.
- **Open in your library from History** (Audiobookshelf or Calibre-Web), with or
  without login.
- **Calmer badges**: counts beside Activity and its pages are soft tints, not red, and
  queued downloads count on Queued, not twice.

**MyAnonamouse**
- **Next slot countdown** in the MyAnonamouse button.
- **The ratio shows two decimals**, worked out from the exact bytes uploaded and
  downloaded.

**Library**
- Books in several series are listed under each of them (*Rhythm of War* in both The
  Cosmere and The Stormlight Archive).
- **My Account → Library** sets the tab the Library opens on and each tab's sort.
- Box sets, omnibuses and collections are left out of missing books (My Account can show
  them), and so are missing books numbered like one you already hold in the series.
- Narrator badges name the first narrator and a count ("Andrew Scott +9").

### Changed
- **Show Downloads When Queued** is off by default and only applies to downloads you
  start. Background changes to the queue never move you to another page.
- Downloads waiting for an unsatisfied slot are checked every 2 minutes (was 5).

### Fixed
- **"Download failed: OSError"**: an audiobook with a large cast made a narrator folder
  name too long for the filesystem. Names are now kept to 240 bytes, ending a long
  narrator list with "et al.", and errors say what went wrong ("File name too long").
- **Non-freeleech audiobooks downloaded automatically below Keep Ratio At Least**: the
  "barely moves the ratio" exception let through anything that lowered it by less than
  0.01, which on a large account is a 500 MB audiobook. It now covers only ebook-sized
  downloads (100 MB or less).
- **Automatic downloads stopped short of the unsatisfied limit** (stalling at 132/150
  with 5 slots kept free): recent snatches were counted again after MAM's own count
  already included them.
- **Retrying a MyAnonamouse download that was already in the torrent client** waited for
  an unsatisfied slot it didn't need.
- **Expired indexer links** are re-found more often: the refresh searches the way the
  book search did, then by title and author, so short titles like *Eric* are found.

### Upgrading
Activity's Later tab is now **Wanted** in the navigation; update bookmarks to the old
pages. Folders an earlier version left half-made after an "OSError" failure aren't cleaned
up; delete them and retry the download.

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
