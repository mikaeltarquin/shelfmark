import type { ActivityItem } from '../components/activity/activityTypes';
import { getLibraryHoldings, getMetadataBookInfo, searchMetadata } from '../services/api';
import type { Book } from '../types';
import { isSameBook, parseBookKey } from './bookActivity';

/**
 * The book an Activity row was downloaded for: the one the download recorded when it
 * did, else the metadata provider's match for its title and author (older downloads).
 * Null when neither finds it.
 */
export const findActivityBook = async (item: ActivityItem): Promise<Book | null> => {
  const key = parseBookKey(item.bookKey);
  if (key) {
    try {
      return await getMetadataBookInfo(key.provider, key.providerId);
    } catch (error) {
      console.warn('Could not load the downloaded book, searching instead:', error);
    }
  }
  const format = item.contentType?.toLowerCase().includes('audio') ? 'audiobook' : 'ebook';
  const author = item.author && item.author !== 'Unknown author' ? item.author : '';
  const result = await searchMetadata(
    `${item.title} ${author}`.trim(),
    10,
    'relevance',
    {},
    1,
    format,
  );
  return (
    result.books.find((candidate) =>
      isSameBook(
        { title: candidate.title, authors: candidate.authors ?? [candidate.author] },
        item.title,
        author || null,
      ),
    ) ?? null
  );
};

/**
 * Where a finished download opens in its library app (Audiobookshelf, Calibre-Web):
 * the copy in the format downloaded when there is one, else any copy with a link.
 * Null when the library doesn't have it yet (it may still be scanning) or links nowhere.
 */
export const findLibraryLink = async (item: ActivityItem): Promise<string | null> => {
  const key = parseBookKey(item.bookKey);
  const holdings = await getLibraryHoldings({
    id: item.bookKey ?? item.id,
    title: item.title,
    author: item.author,
    ...(key ? { provider: key.provider, provider_id: key.providerId } : {}),
  });
  const wanted = item.contentType?.toLowerCase().includes('audio') ? 'audiobook' : 'ebook';
  const linked = holdings.filter((holding) => holding.url);
  const match = linked.find((holding) => holding.formats.includes(wanted)) ?? linked[0];
  return match?.url ?? null;
};
