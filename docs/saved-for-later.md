# Saved for Later

Keep books to download later, for example when you're out of MyAnonamouse upload credit
or unsatisfied slots. Each user has their own list. With no login, everyone shares one.

## Saving

- **A book**: the bookmark on a search result or library card (beside Details and Get on
  a phone), or at the left of a row in the library's tables. Saved this way, you pick a
  release when you get it. A library book held in one format is saved for the other.
- **One release**: the bookmark beside a release's download button. Getting it later
  downloads exactly that release.
- **A combined pick**: in the combined (ebook + audiobook) flow, **Save for later** in the
  footer keeps everything picked so far: the ebook and every audiobook (narrator).
- **From the hold-back prompt**: when a download is held back for the MyAnonamouse buffer
  or the unsatisfied limit, **Save for later** in that prompt keeps exactly what you were
  downloading (one release, or the whole combined pick) instead of dropping it. It isn't
  offered while acting on behalf of another user.

A book is saved once. Saving it again with a release replaces the earlier pick, and
saving it again on its own keeps the pick. A filled bookmark means the book (or, on a
release row, that release) is saved; click it again to remove it.

## Queued, or Wanted

A saved item is one of two things, marked on books everywhere they show:

- **Wanted** (amber bookmark): a book with no release picked yet, or picks that couldn't
  be queued (the error says why).
- **Queued** (blue): releases are picked and it downloads on its own once there's room
  (see below). Picking releases queues them straight away when **Get Saved Books
  Automatically** is on.

## The Queued and Wanted pages

**Activity → Queued** is everything waiting to download, in the order it goes:

- **Up next**: downloads already handed to Shelfmark that haven't started, such as a
  MyAnonamouse torrent waiting for an unsatisfied slot. They're numbered in the order they
  start; drag a row by its handle (or use the arrows) to change it.
- **Waiting for room**: saved picks, numbered after them, each showing its **Releases** (one line per
  release, with the format, narrator and a link to its page at the source, the torrent on
  MyAnonamouse for example), what it's **Waiting for**, when it was **Last checked** and a
  countdown to the **Next check**. Drag these to reorder them too: earlier ones get free
  room first. **+ Get** downloads one now without waiting; **Remove** drops it.

**Wanted** lists books saved without picks. **Choose releases** opens the release list;
pick and save, and the book moves to Queued. Rows with picks that couldn't be queued
have **Choose again** and **+ Get**.

**+ Get** downloads through the usual path: the MyAnonamouse buffer and unsatisfied
checks still apply, and for users who need approval it becomes a request. Titles and
covers on either page open the book's details.

A book leaves Saved once it's downloaded: on Get, or when you download it (or one of its
picked releases) any other way.

## Getting automatically

A background check (every 10 minutes by default, and a few seconds after you queue
something) goes through the queue in order. Each release in an item is weighed on its
own, cheapest first (not on MyAnonamouse, then freeleech, then by size), so a freeleech
torrent or a small ebook isn't held back by a big audiobook picked with it. A release
goes once:

- its MyAnonamouse torrent fits the buffer and the unsatisfied limit together with the
  releases already going, the same check as a manual download (keeping the slots set in
  **Unsatisfied Slots to Keep Free**);
- you could download it directly, without a request (users who need approval use **Get**);
- it won't drag your ratio down:
  - **Freeleech** torrents go as soon as there's room, since they can't lower the ratio.
    Freeleech is checked live on MyAnonamouse at each check, so a site-wide freeleech, a
    personal freeleech wedge, or VIP freeleech (for a VIP account) all count;
  - anything else goes when the ratio stays at **Keep Ratio At Least** (2.0 by default)
    with this download and Shelfmark's other active MAM downloads counted in full, or
    when it's ebook-sized (100 MB or less) and lowers the ratio by less than 0.01;
  - otherwise it waits until the ratio allows it or the torrent turns freeleech,
    whichever comes first.

Upload credit is never bought for an automatic download. Each item shows why it's still
waiting ("Waiting for 2 unsatisfied slots", "Waiting for freeleech or ratio 2.00: 1.20 GB
would take it from 1.84 to 1.81"). If MyAnonamouse can't be read, its torrents wait
rather than risk the account. Releases that aren't MyAnonamouse torrents have nothing to
wait for and download at the next check.

When some of an item's releases go and others wait, the ones that went download now and
the rest stay queued. An ebook that goes ahead of its audiobooks is still filed in their
narrator folders (see [Keeping ebooks with audiobooks](audiobookshelf.md#keeping-ebooks-with-audiobooks)).
Once everything has gone the item leaves Saved. Each time, a toast says so and a **Saved
book got automatically** notification goes out to notification routes subscribed to that
event (or to **All**). If a release can't be queued, the error shows on the item.

Queuing something doesn't take you away from the page you're on. **Show Downloads When
Queued** (off by default) goes to Activity → Downloads when you start a download
yourself; background downloads never move the page.

**Settings → Indexers → Prowlarr → Saved for Later** has the global switch (**Get Saved
Books Automatically**, on by default; turning it off pauses every item without unmarking
it), **Keep Ratio At Least** (0 turns the ratio check off) and the check interval (at
least 5 minutes).
