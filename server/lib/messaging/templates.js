// Patient message templates (en / ml / hi). The same ordered parameters feed approved WhatsApp templates
// (WHATSAPP_TEMPLATES maps kind -> template name; default "fad_<kind>"), SMS text and in-app notifications.
export const PARAM_ORDER = {
  booking_confirmation: ['doctor', 'when', 'location', 'code', 'link'],
  reminder_24h: ['doctor', 'when', 'location', 'link'],
  reminder_2h: ['doctor', 'when', 'location', 'link'],
  queue_soon: ['doctor', 'position', 'token'],
  your_turn: ['doctor', 'token'],
  running_late: ['doctor', 'minutes'],
  waitlist_offer: ['doctor', 'when', 'minutes', 'link'],
  medicine: ['medicine', 'dosage', 'timing'],
  lab_status: ['code', 'status']
};

const T = {
  en: {
    booking_confirmation: ['Booking confirmed', 'Your appointment with {doctor} on {when} at {location} is confirmed (ref {code}). Manage: {link}'],
    reminder_24h: ['Appointment tomorrow', 'Reminder: {doctor} on {when} at {location}. Reschedule or cancel: {link}'],
    reminder_2h: ['Appointment in 2 hours', 'Reminder: your appointment with {doctor} is at {when}, {location}. Manage: {link}'],
    queue_soon: ['Your turn is coming up', '{doctor}: {position} patient(s) ahead of you (token {token}). Please be ready.'],
    your_turn: ['It is your turn', '{doctor} is ready to see you now (token {token}).'],
    running_late: ['Doctor running late', '{doctor} is running about {minutes} minutes late today. Your updated time is in the app.'],
    waitlist_offer: ['A slot opened up', 'A slot with {doctor} on {when} is free. Claim it within {minutes} minutes: {link}'],
    medicine: ['Medicine reminder', 'Time for {medicine} {dosage} {timing}'],
    lab_status: ['Lab test update', 'Lab order {code}: {status}']
  },
  ml: {
    booking_confirmation: ['ബുക്കിംഗ് സ്ഥിരീകരിച്ചു', '{doctor} ഡോക്ടറുമായുള്ള {when}, {location} അപ്പോയിന്റ്മെന്റ് സ്ഥിരീകരിച്ചു (റഫ് {code}). മാറ്റാൻ: {link}'],
    reminder_24h: ['നാളെ അപ്പോയിന്റ്മെന്റ്', 'ഓർമ്മപ്പെടുത്തൽ: {doctor}, {when}, {location}. മാറ്റാനോ റദ്ദാക്കാനോ: {link}'],
    reminder_2h: ['2 മണിക്കൂറിനുള്ളിൽ അപ്പോയിന്റ്മെന്റ്', 'ഓർമ്മപ്പെടുത്തൽ: {doctor} ഡോക്ടറുമായുള്ള അപ്പോയിന്റ്മെന്റ് {when}, {location}. {link}'],
    queue_soon: ['നിങ്ങളുടെ ഊഴം അടുത്തു', '{doctor}: നിങ്ങൾക്ക് മുമ്പ് {position} പേർ (ടോക്കൺ {token}). തയ്യാറായിരിക്കുക.'],
    your_turn: ['നിങ്ങളുടെ ഊഴം', '{doctor} ഇപ്പോൾ നിങ്ങളെ കാണാൻ തയ്യാറാണ് (ടോക്കൺ {token}).'],
    running_late: ['ഡോക്ടർ വൈകുന്നു', '{doctor} ഇന്ന് ഏകദേശം {minutes} മിനിറ്റ് വൈകുന്നു. പുതിയ സമയം ആപ്പിൽ കാണാം.'],
    waitlist_offer: ['ഒരു സ്ലോട്ട് ലഭ്യമാണ്', '{doctor}, {when} സ്ലോട്ട് ഒഴിവുണ്ട്. {minutes} മിനിറ്റിനുള്ളിൽ ബുക്ക് ചെയ്യുക: {link}'],
    medicine: ['മരുന്ന് ഓർമ്മപ്പെടുത്തൽ', '{medicine} {dosage} {timing} കഴിക്കാനുള്ള സമയം'],
    lab_status: ['ലാബ് ടെസ്റ്റ് അപ്‌ഡേറ്റ്', 'ലാബ് ഓർഡർ {code}: {status}']
  },
  hi: {
    booking_confirmation: ['बुकिंग कन्फ़र्म', '{doctor} के साथ {when}, {location} पर आपकी अपॉइंटमेंट कन्फ़र्म है (रेफ़ {code})। बदलें: {link}'],
    reminder_24h: ['कल अपॉइंटमेंट है', 'रिमाइंडर: {doctor}, {when}, {location}। बदलें या रद्द करें: {link}'],
    reminder_2h: ['2 घंटे में अपॉइंटमेंट', 'रिमाइंडर: {doctor} के साथ आपकी अपॉइंटमेंट {when}, {location} पर है। {link}'],
    queue_soon: ['आपकी बारी आने वाली है', '{doctor}: आपसे पहले {position} मरीज़ (टोकन {token})। कृपया तैयार रहें।'],
    your_turn: ['आपकी बारी है', '{doctor} अब आपको देखने के लिए तैयार हैं (टोकन {token})।'],
    running_late: ['डॉक्टर देरी से', '{doctor} आज लगभग {minutes} मिनट देरी से हैं। नया समय ऐप में देखें।'],
    waitlist_offer: ['स्लॉट खाली हुआ', '{doctor} के साथ {when} का स्लॉट खाली है। {minutes} मिनट में बुक करें: {link}'],
    medicine: ['दवा रिमाइंडर', '{medicine} {dosage} {timing} लेने का समय'],
    lab_status: ['लैब टेस्ट अपडेट', 'लैब ऑर्डर {code}: {status}']
  }
};

export function render(kind, lang, params = {}) {
  const set = T[lang] || T.en;
  const [title, body] = set[kind] || T.en[kind] || [kind, ''];
  const fill = s => s.replace(/\{(\w+)\}/g, (_, k) => (params[k] === undefined || params[k] === null ? '' : String(params[k]))).replace(/\s+/g, ' ').trim();
  return { title: fill(title), body: fill(body) };
}

export function orderedParams(kind, params = {}) {
  return (PARAM_ORDER[kind] || Object.keys(params)).map(k => String(params[k] ?? '').slice(0, 300));
}
