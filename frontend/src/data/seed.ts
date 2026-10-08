import type { Task } from '../types';
import { dayLabel, doneStampAt, shiftDays, stamp } from '../lib/format';

/** Who the lots are prepared for. */
export const OWNER = 'carla';

/** Where a hand-written lot goes when handed back. */
export const STUDIO = 'the studio';

/**
 * The twelve fixed lots of the prototype (§3). Dates are derived from the day the
 * app is opened so the seed never reads as stale; the relative offsets are the ones
 * the reference design ships with.
 */
export function seedTasks(now = new Date()): Task[] {
  const at = (days: number, time: string) => {
    const d = shiftDays(days, now);
    const [h, m] = time.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const created = (days: number) => stamp(shiftDays(days, now));
  const iso = (days: number, time: string) => at(days, time).toISOString();
  const id = (lot: number) => `seed-${lot}`;

  return [
    {
      id: id(9),
      lot: 9,
      title: 'order 500 cream labels, 60 × 40 mm',
      context: 'studio',
      bucket: 'past',
      due: dayLabel(shiftDays(-3, now)),
      est: 15,
      done: true,
      doneAt: doneStampAt(at(-3, '10:12')),
      created: created(-6),
      notes: 'matte, uncoated. same supplier as the spring batch.',
      refs: [],
    },
    {
      id: id(11),
      lot: 11,
      title: 'fix the studio lamp',
      context: 'home',
      bucket: 'past',
      due: dayLabel(shiftDays(-2, now)),
      est: 30,
      done: true,
      doneAt: doneStampAt(at(-2, '19:05')),
      created: created(-4),
      notes: '',
      refs: [],
    },
    {
      id: id(12),
      lot: 12,
      title: 'book the dentist',
      context: 'errands',
      bucket: 'today',
      due: '11:00',
      est: 5,
      done: true,
      doneAt: doneStampAt(at(0, '08:51')),
      created: created(-1),
      notes: '',
      refs: [],
    },
    {
      id: id(14),
      lot: 14,
      title: 'call the printer about paper samples',
      context: 'studio',
      bucket: 'today',
      due: '16:30',
      est: 25,
      done: false,
      doneAt: null,
      created: created(-1),
      notes: 'ask for 300 gsm, matte. mention the colour drift on the last run.',
      refs: [
        {
          k: 'printer',
          v: 'gráfica lumen',
          source: { kind: 'order', id: 'ord-2214', label: 'order nº 2214', at: iso(-31, '09:40') },
        },
        {
          k: 'ask for',
          v: 'sr. almeida',
          source: {
            kind: 'contact',
            id: 'c-almeida',
            label: 'contacts · almeida, lumen',
            at: iso(-120, '11:02'),
          },
        },
        {
          k: 'phone',
          v: '+351 21 342 00 11',
          source: {
            kind: 'contact',
            id: 'c-almeida',
            label: 'contacts · almeida, lumen',
            at: iso(-120, '11:02'),
          },
        },
        {
          k: 'last order',
          v: 'nº 2214 · 300 gsm matte',
          source: { kind: 'order', id: 'ord-2214', label: 'order nº 2214', at: iso(-31, '09:40') },
        },
      ],
      action: {
        kind: 'call',
        cta: 'call +351 21 342 00 11',
        target: 'tel:+351213420011',
        note: 'dialled',
      },
    },
    {
      id: id(15),
      lot: 15,
      title: 'reply to the accountant re: q3 invoices',
      context: 'work',
      bucket: 'today',
      due: '12:00',
      est: 15,
      done: false,
      doneAt: null,
      created: created(-1),
      notes: '',
      refs: [
        {
          k: 'to',
          v: 'rui@contasrivera.pt',
          source: { kind: 'email', id: 'th-q3', label: 'mail · re: q3 invoices', at: iso(-6, '08:14') },
        },
        {
          k: 'subject',
          v: 're: q3 invoices',
          source: { kind: 'email', id: 'th-q3', label: 'mail · re: q3 invoices', at: iso(-6, '08:14') },
        },
        {
          k: 'open',
          v: '3 invoices · €4 180',
          source: { kind: 'email', id: 'th-q3', label: 'mail · re: q3 invoices', at: iso(-6, '08:14') },
          confidence: 0.82,
        },
        {
          k: 'waiting',
          v: '6 days',
          source: { kind: 'email', id: 'th-q3', label: 'mail · re: q3 invoices', at: iso(-6, '08:14') },
        },
      ],
      action: {
        kind: 'open',
        cta: 'open the thread',
        target: 'mailto:rui@contasrivera.pt?subject=re%3A%20q3%20invoices',
        note: 'opened',
      },
    },
    {
      id: id(16),
      lot: 16,
      title: 'pick up the dry cleaning',
      context: 'errands',
      bucket: 'today',
      due: '18:00',
      est: 20,
      done: false,
      doneAt: null,
      created: created(-1),
      notes: '',
      refs: [
        {
          k: 'shop',
          v: 'lavandaria estrela',
          source: { kind: 'order', id: 'tk-4471', label: 'ticket nº 4471', at: iso(-4, '17:20') },
        },
        {
          k: 'address',
          v: 'r. da rosa 112',
          source: {
            kind: 'contact',
            id: 'c-estrela',
            label: 'contacts · lavandaria estrela',
            at: iso(-200, '10:00'),
          },
        },
        {
          k: 'closes',
          v: '19:00',
          source: {
            kind: 'contact',
            id: 'c-estrela',
            label: 'contacts · lavandaria estrela',
            at: iso(-200, '10:00'),
          },
        },
        {
          k: 'ticket',
          v: 'nº 4471 · paid',
          source: { kind: 'order', id: 'tk-4471', label: 'ticket nº 4471', at: iso(-4, '17:20') },
        },
      ],
      action: {
        kind: 'map',
        cta: 'open in maps',
        target: 'https://maps.apple.com/?q=Lavandaria%20Estrela%2C%20R.%20da%20Rosa%20112%2C%20Lisboa',
        note: 'opened',
      },
    },
    {
      id: id(17),
      lot: 17,
      title: 'water the fig tree',
      context: 'home',
      bucket: 'today',
      due: '09:00',
      est: 5,
      done: true,
      doneAt: doneStampAt(at(0, '07:40')),
      created: created(-1),
      notes: '',
      refs: [],
    },
    {
      id: id(18),
      lot: 18,
      title: 'write the newsletter intro',
      context: 'work',
      bucket: 'today',
      due: '15:00',
      est: 45,
      done: false,
      doneAt: null,
      created: created(-1),
      notes: '',
      refs: [],
    },
    {
      id: id(19),
      lot: 19,
      title: 'send the moodboard to lena',
      context: 'work',
      bucket: 'upcoming',
      due: dayLabel(shiftDays(1, now)),
      est: 15,
      done: false,
      doneAt: null,
      created: created(-1),
      notes: '',
      refs: [
        {
          k: 'to',
          v: 'lena@studiolena.co',
          source: { kind: 'contact', id: 'c-lena', label: 'contacts · lena', at: iso(-300, '12:00') },
        },
        {
          k: 'file',
          v: 'ss30-moodboard.pdf · 14 mb',
          source: {
            kind: 'drive',
            id: 'dr-ss30',
            label: 'drive · ss30 / moodboard',
            url: 'https://drive.example/ss30-moodboard.pdf',
            at: iso(-9, '16:41'),
          },
          confidence: 0.88,
        },
        {
          k: 'she asked',
          v: '11.09 · "before friday"',
          source: { kind: 'email', id: 'th-lena', label: 'mail · ss30', at: iso(-5, '09:12') },
        },
      ],
      action: {
        kind: 'send',
        cta: 'send ss30-moodboard.pdf',
        target: 'mailto:lena@studiolena.co?subject=ss30-moodboard.pdf',
        note: 'sent',
      },
    },
    {
      id: id(20),
      lot: 20,
      title: 'renew passport',
      context: 'errands',
      bucket: 'upcoming',
      due: dayLabel(shiftDays(3, now)),
      est: 60,
      done: false,
      doneAt: null,
      created: created(-1),
      notes: 'bring two photos and the old passport.',
      refs: [
        {
          k: 'where',
          v: 'loja do cidadão, laranjeiras',
          source: { kind: 'calendar', id: 'ev-88204', label: 'calendar · passport', at: iso(-14, '11:20') },
        },
        {
          k: 'booked',
          v: '11:20 · ref 88-204',
          source: { kind: 'calendar', id: 'ev-88204', label: 'calendar · passport', at: iso(-14, '11:20') },
        },
        {
          k: 'bring',
          v: '2 photos · old passport',
          source: { kind: 'manual', id: 'm-1', label: 'typed by you', at: iso(-14, '11:25') },
        },
      ],
    },
    {
      id: id(21),
      lot: 21,
      title: 'draft label copy for the autumn batch',
      context: 'studio',
      bucket: 'upcoming',
      due: dayLabel(shiftDays(4, now)),
      est: 60,
      done: false,
      doneAt: null,
      created: created(-1),
      notes: '',
      refs: [],
    },
    {
      id: id(22),
      lot: 22,
      title: 'plan the weekend in porto',
      context: 'home',
      bucket: 'upcoming',
      due: 'someday',
      est: 30,
      done: false,
      doneAt: null,
      created: created(-1),
      notes: '',
      refs: [],
    },
  ];
}
