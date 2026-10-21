// -----------------------------------------------------------------------------
// Review moderation word list (server-side config).
//
// Reviews containing any of these words/phrases are automatically flagged:
// hidden from the public and listed under Admin > Reviews > Flagged.
//
// - Matching is case-insensitive and whole-word (so "class" never matches "ass").
// - Common obfuscation is normalised first: leetspeak (@->a, $->s, 0->o, 1->i,
//   3->e, 4->a, 5->s, 7->t), repeated letters ("fuuuuck"), and separators inside
//   a word ("f.u.c.k", "f*ck" -> also listed explicitly where common).
// - Multi-word entries are matched as phrases.
// - Admins can add extra words or disable defaults from Admin > Settings; those
//   overrides are stored in the database (Settings.extraBadWords / disabledBadWords)
//   and merged with this list at runtime.
//
// Keep entries lowercase. Avoid words that are also ordinary medical vocabulary
// (deliberately NOT listed: "prick" (needle prick), "mc"/"bc" (menstrual cycle /
// birth control), "kutta"/"suar"/"panni" alone (dog bite, swine flu), "kutti"
// (Malayalam: child)).
// -----------------------------------------------------------------------------

export const ENGLISH = [
  'fuck', 'fucks', 'fucked', 'fucker', 'fuckers', 'fucking', 'fuckin', 'fck', 'fcking', 'fuk', 'fuking', 'fuq', 'f*ck', 'f**k',
  'motherfucker', 'motherfucking', 'mofo', 'wtf', 'stfu',
  'shit', 'shitty', 'bullshit', 'shithead', 'sh*t',
  'bitch', 'bitches', 'b*tch', 'biatch', 'son of a bitch',
  'bastard', 'bastards',
  'asshole', 'assholes', 'arsehole', 'a**hole', 'dumbass', 'jackass', 'ass', 'arse',
  'dick', 'dickhead', 'dicks', 'cock', 'cocksucker',
  'cunt', 'cunts', 'twat', 'pussy', 'wanker', 'wank',
  'slut', 'sluts', 'whore', 'whores', 'hoe',
  'piss off', 'pissed off', 'screw you', 'go to hell', 'damn you',
  'retard', 'retarded', 'moron', 'idiot', 'idiots', 'imbecile', 'scumbag', 'douchebag', 'douche',
  'nigger', 'nigga', 'faggot', 'fag', 'tranny', 'chink', 'paki',
  'kill yourself', 'kys'
];

// Common Hindi / Hinglish abuses (romanised / transliterated)
export const HINDI = [
  'chutiya', 'chutiye', 'chutia', 'chootiya', 'chutiyapa', 'choot', 'chut',
  'madarchod', 'maderchod', 'madarchood', 'madarjaat', 'mkc', 'maa ki chut', 'teri maa ki',
  'behenchod', 'bhenchod', 'behanchod', 'bhencho', 'bkl', 'bhenkelode', 'behen ke lode',
  'bhosdike', 'bhosadike', 'bhosdi', 'bhosda', 'bhosdiwale', 'bsdk', 'bhosadpappu',
  'gandu', 'gaandu', 'gaand', 'gand mara', 'gaand mara', 'gandmasti',
  'lund', 'lauda', 'lavda', 'lawda', 'loda', 'lodu', 'laude', 'lavde', 'lund ka',
  'randi', 'randwa', 'raand', 'randibaaz', 'chinal', 'kutiya',
  'harami', 'haraami', 'haramkhor', 'haramzada', 'haramzaade', 'haraamzaada',
  'kamina', 'kamine', 'kaminey', 'kamini',
  'kutte ki aulad', 'suar ki aulad',
  'bhadwa', 'bhadwe', 'bhadve', 'bhadwaa', 'dalla',
  'chodu', 'chod', 'chodna', 'chudai', 'chudwa', 'chut ke',
  'jhaat', 'jhatu', 'jhaatu', 'jhant', 'tatte', 'tatti kha',
  'ullu ka pattha', 'ullu ke pathe', 'gadha', 'gadhe', 'nalayak', 'besharam', 'bewakoof'
];

// Common Malayalam abuses (Manglish / transliterated). A few Tamil ones are
// included because they are common in Kerala border regions.
export const MALAYALAM = [
  'myre', 'myru', 'myr', 'mairu', 'maire', 'mayire', 'myran', 'myrandi', 'mairan', 'myrmon',
  'poori', 'poorimone', 'poorimon', 'poorimole', 'poorimol', 'pooru', 'poore', 'pooran',
  'thayoli', 'thaayoli', 'thayolli', 'thayoli mone', 'thallayoli',
  'kunna', 'kunne', 'kunnayi', 'kunnan', 'kunnappan',
  'koothi', 'koothichi', 'kundi', 'kundan', 'kundi mone',
  'pulayadi', 'pulayadi mone', 'pulayadimone', 'pulayadimol',
  'naaye', 'naayinte mone', 'nayinte mone', 'patti mone', 'panni mone',
  'thendi', 'thendi mone', 'chetta naaye', 'oombi', 'oombu', 'oomban', 'kazhuveri', 'kazhuverude mone',
  'kandaroli', 'andimone', 'vedichi',
  'thevidiya', 'thevdiya', 'punda', 'pundachi', 'otha', 'ommala'
];

export const DEFAULT_BAD_WORDS = [...new Set([...ENGLISH, ...HINDI, ...MALAYALAM].map(w => w.toLowerCase().trim()))];
