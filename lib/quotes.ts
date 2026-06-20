/**
 * quotes — curated daily quote pool for the Home week deck.
 *
 * No external API: a fixed public-domain pool rotated by day-of-year so the
 * line under the header is stable for a given calendar day and varies across
 * the year. Sources are deliberately public domain — Franklin / Poor Richard,
 * anonymous sailor proverbs and naval blessings, public-domain renderings of
 * the Stoics (Epictetus, Seneca, Marcus Aurelius), and public-domain-era naval
 * figures (Nelson, John Paul Jones). Modern copyrighted translations and
 * 20th-century attributed aphorisms are intentionally excluded.
 *
 * Keep entries short (they render on one or two lines). Add freely — the
 * selector is length-agnostic.
 */

export interface Quote {
  text: string
  author: string
}

export const QUOTES: Quote[] = [
  // ── Benjamin Franklin / Poor Richard's Almanack ──
  { text: 'Lost time is never found again.', author: 'Benjamin Franklin' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { text: 'Diligence is the mother of good luck.', author: 'Benjamin Franklin' },
  { text: 'An investment in knowledge pays the best interest.', author: 'Benjamin Franklin' },
  { text: 'Energy and persistence conquer all things.', author: 'Benjamin Franklin' },
  { text: 'Little strokes fell great oaks.', author: 'Benjamin Franklin' },
  { text: 'He that can have patience can have what he will.', author: 'Benjamin Franklin' },
  { text: 'A small leak will sink a great ship.', author: 'Benjamin Franklin' },
  { text: 'Either write something worth reading or do something worth writing.', author: 'Benjamin Franklin' },
  { text: 'By failing to prepare, you are preparing to fail.', author: 'Benjamin Franklin' },
  { text: 'Hide not your talents; they for use were made.', author: 'Benjamin Franklin' },
  { text: 'Early to bed and early to rise makes a man healthy, wealthy, and wise.', author: 'Benjamin Franklin' },
  { text: 'Tomorrow every fault is to be amended — but that tomorrow never comes.', author: 'Benjamin Franklin' },
  { text: 'Have you somewhat to do tomorrow? Do it today.', author: 'Benjamin Franklin' },
  { text: 'Drive thy business, let not that drive thee.', author: 'Benjamin Franklin' },
  { text: 'Three may keep a secret, if two of them are dead.', author: 'Benjamin Franklin' },
  { text: 'One today is worth two tomorrows.', author: 'Benjamin Franklin' },

  // ── Sailor & naval proverbs (anonymous, public domain) ──
  { text: 'A smooth sea never made a skilled sailor.', author: 'Sailor\u2019s proverb' },
  { text: 'We cannot direct the wind, but we can adjust the sails.', author: 'Proverb' },
  { text: 'A ship in harbor is safe — but that is not what ships are built for.', author: 'Sailor\u2019s proverb' },
  { text: 'Hoist your sail when the wind is fair.', author: 'Sailor\u2019s proverb' },
  { text: 'Fair winds and following seas.', author: 'Naval blessing' },
  { text: 'Calm seas do not make good sailors.', author: 'Sailor\u2019s proverb' },
  { text: 'Red sky at night, sailor\u2019s delight; red sky at morning, sailors take warning.', author: 'Sailor\u2019s proverb' },
  { text: 'Any port in a storm.', author: 'Sailor\u2019s proverb' },
  { text: 'The wind and the waves are always on the side of the ablest navigator.', author: 'Proverb' },
  { text: 'He who would learn to pray, let him go to sea.', author: 'Sailor\u2019s proverb' },
  { text: 'A good sailor is known in bad weather.', author: 'Sailor\u2019s proverb' },
  { text: 'Trust the sea, and it will swallow you; respect it, and it will carry you.', author: 'Sailor\u2019s proverb' },
  { text: 'Steer by the stars, not by the wake.', author: 'Sailor\u2019s proverb' },

  // ── Naval figures (public-domain era) ──
  { text: 'I have not yet begun to fight.', author: 'John Paul Jones' },
  { text: 'England expects that every man will do his duty.', author: 'Horatio Nelson' },
  { text: 'Desperate affairs require desperate measures.', author: 'Horatio Nelson' },
  { text: 'He who will not risk cannot win.', author: 'John Paul Jones' },

  // ── Epictetus (Enchiridion / Discourses, public domain) ──
  { text: 'It is not what happens to you, but how you react to it that matters.', author: 'Epictetus' },
  { text: 'No man is free who is not master of himself.', author: 'Epictetus' },
  { text: 'First say to yourself what you would be; then do what you have to do.', author: 'Epictetus' },
  { text: 'He is a wise man who does not grieve for what he has not, but rejoices for what he has.', author: 'Epictetus' },
  { text: 'Make the best use of what is in your power, and take the rest as it happens.', author: 'Epictetus' },
  { text: 'Difficulties are things that show a person what they are.', author: 'Epictetus' },

  // ── Seneca (public-domain translations / common renderings) ──
  { text: 'We suffer more often in imagination than in reality.', author: 'Seneca' },
  { text: 'It is not that we have a short time to live, but that we waste much of it.', author: 'Seneca' },
  { text: 'While we wait for life, life passes.', author: 'Seneca' },
  { text: 'Difficulties strengthen the mind, as labor does the body.', author: 'Seneca' },
  { text: 'He who is brave is free.', author: 'Seneca' },
  { text: 'Every new beginning comes from some other beginning\u2019s end.', author: 'Seneca' },
  { text: 'Luck is what happens when preparation meets opportunity.', author: 'Seneca' },
  { text: 'As long as you live, keep learning how to live.', author: 'Seneca' },

  // ── Marcus Aurelius (Meditations, public-domain renderings) ──
  { text: 'The happiness of your life depends upon the quality of your thoughts.', author: 'Marcus Aurelius' },
  { text: 'Confine yourself to the present.', author: 'Marcus Aurelius' },
  { text: 'If you are disturbed by a thing, it is not the thing, but your judgment of it.', author: 'Marcus Aurelius' },
  { text: 'Look within. Within is the fountain of good, ever ready to spring up.', author: 'Marcus Aurelius' },
  { text: 'Do every act of your life as if it were the last.', author: 'Marcus Aurelius' },
  { text: 'Loss is nothing else but change, and change is Nature\u2019s delight.', author: 'Marcus Aurelius' },
  { text: 'Begin at once to live, and count each day as a separate life.', author: 'Marcus Aurelius' },
]

/** Day-of-year (1\u2013366) for a date, using its local Y/M/D components. */
function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getFullYear(), 0, 0)
  const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.floor((today - start) / 86_400_000)
}

/**
 * The quote for a given day. Deterministic per calendar day; the year offset
 * shifts the rotation so the same day in consecutive years isn't identical.
 * Defaults to today.
 */
export function quoteForDay(date: Date = new Date()): Quote {
  const n = QUOTES.length
  if (n === 0) return { text: '', author: '' }
  const idx = (dayOfYear(date) + date.getFullYear()) % n
  return QUOTES[idx]
}
