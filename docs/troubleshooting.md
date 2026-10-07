# Troubleshooting

## "Download failed: File name too long"

A folder or file name went over the filesystem's limit (usually 255 bytes), most often
an audiobook with a large cast in `{Narrator}`. Shelfmark keeps names to 240 bytes,
ending a long narrator list with `et al.` (see
[Audiobookshelf Folders](audiobookshelf.md#the-narrator-variable)), so **Retry** the
download. Older versions reported this as just "OSError".

If an earlier attempt left part of the book in a folder of its own (say, the audiobook
imported but the ebook failed), move or delete it once the retry has finished.

## "The indexer download link expired"

Prowlarr's download links for a release stop working after a while, so a release saved
or queued long ago can't be fetched as it was. Shelfmark searches again on its own to
find the same release: first the way the book search found it, then by title and first
author (which finds books with very short titles, like *Eric*), and downloads it from
the fresh result. This error means none of those searches returned it. Search for the
book again, or use the source link in Activity to grab it from the indexer by hand.

## "Waiting for an unsatisfied slot on MyAnonamouse"

Not an error: the account is at its unsatisfied limit (counting **Unsatisfied Slots to
Keep Free**), and the download starts on its own once a torrent finishes its 72 hours.
It's listed under **Activity → Queued → Up next**, with the countdown to the next slot in
the MyAnonamouse button. See
[Unsatisfied limit](myanonamouse-enrichment.md#unsatisfied-limit).

## "MyAnonamouse is rejecting …'s announces" or "MyAnonamouse has paused downloads"

MAM downloads are on hold, whatever the free slots. **Rejected announces**: MAM doesn't
recognise the torrent client's IP or passkey, so it isn't counting new torrents; fix the
IP registration (mousehole, VPN) and the downloads go once a re-announce succeeds.
**Paused downloads**: a grab went past the unsatisfied limit and MAM refuses downloads
until the time shown. See
[Unsatisfied limit](myanonamouse-enrichment.md#unsatisfied-limit).

## "Downloading in Deluge" or "No progress in Deluge for … minutes"

Not an error. Once the torrent client has had a torrent for 30 seconds, Shelfmark leaves
it downloading there and moves on to the next download, so more torrents download at
once than there are download workers. The row in **Downloads** shows the client's
progress (checked every 30 seconds), and the files are picked up when it's finished.
"No progress" means it hasn't moved for 5 minutes or more: no peers yet, queued in the
client, or the tracker refusing it for now. If the torrent is removed from the client,
the download fails saying so. Cancel it from Activity to stop watching it (the torrent
stays in the client). After a restart it shows as interrupted: Retry finds the torrent
in the client by its hash.

## A queued book doesn't download

**Activity → Queued** says what each saved pick is waiting for (unsatisfied slots, buffer,
freeleech or the ratio) and when it's next checked. See
[Getting automatically](saved-for-later.md#getting-automatically).
