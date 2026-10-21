// Multilingual symptom dictionaries: English, Malayalam (script + Manglish transliteration), Hindi
// (Devanagari + Hinglish). Used on top of the per-speciality keywords stored in the database.
// Matching is substring based on normalised text; Latin keywords also match with spaces removed
// ("nenju vedana" == "nenjuvedana").

// Red flags => emergency banner (108 / 112). Order matters only for display.
export const RED_FLAGS = {
  chest_pain: {
    label: 'Chest pain or pressure',
    kw: ['chest pain', 'chest tightness', 'pressure in chest', 'pain in chest', 'heart attack', 'crushing chest',
      'നെഞ്ചുവേദന', 'നെഞ്ച് വേദന', 'നെഞ്ചിൽ വേദന', 'nenju vedana', 'nenjuvedana', 'nenjil vedana', 'nenjuvetha',
      'सीने में दर्द', 'छाती में दर्द', 'दिल का दौरा', 'seene mein dard', 'seene me dard', 'chhati me dard', 'chhati mein dard', 'chati me dard', 'dil ka daura']
  },
  stroke: {
    label: 'Stroke signs (face drooping, arm weakness, speech difficulty)',
    kw: ['face drooping', 'face droop', 'drooping face', 'slurred speech', 'arm weakness', 'one side weak', 'one side of body', 'sudden numbness', 'cannot speak', "can't speak", 'paralysis', 'stroke',
      'മുഖം കോടി', 'മുഖം കോടുന്നു', 'സംസാരം കുഴയുന്നു', 'കൈ തളരുന്നു', 'ഒരു വശം തളർന്നു', 'പക്ഷാഘാതം', 'mukham kodi', 'samsaram kuzhayunnu', 'oru vasham thalarnnu', 'pakshaghatham',
      'चेहरा टेढ़ा', 'लकवा', 'बोलने में दिक्कत', 'हाथ में कमजोरी', 'lakwa', 'lakva', 'chehra tedha', 'bolne me dikkat', 'zuban ladkhada']
  },
  breathing: {
    label: 'Severe difficulty breathing',
    kw: ['cannot breathe', "can't breathe", 'cant breathe', 'difficulty breathing', 'trouble breathing', 'shortness of breath', 'gasping', 'choking', 'lips turning blue', 'blue lips',
      'ശ്വാസം മുട്ടൽ', 'ശ്വാസം മുട്ടുന്നു', 'ശ്വാസതടസ്സം', 'ശ്വാസം കിട്ടുന്നില്ല', 'shwasam muttal', 'swasam muttal', 'shwasam kittunnilla', 'swasam kittunnilla', 'swasamuttal',
      'सांस नहीं', 'सांस लेने में तकलीफ', 'सांस फूल', 'दम घुट', 'saans nahi', 'saans lene me dikkat', 'saans lene mein takleef', 'saans phool', 'sans nahi aa'],
  },
  bleeding: {
    label: 'Severe or uncontrolled bleeding',
    kw: ['heavy bleeding', 'bleeding heavily', 'severe bleeding', "won't stop bleeding", 'wont stop bleeding', 'bleeding not stopping', 'vomiting blood', 'blood in vomit', 'coughing blood', 'coughing up blood',
      'രക്തസ്രാവം', 'ചോര നിൽക്കുന്നില്ല', 'രക്തം ഛർദ്ദിച്ചു', 'chora nilkkunnilla', 'raktham pokunnu', 'chora chardhichu',
      'बहुत खून', 'खून बह रहा', 'खून की उल्टी', 'khoon beh raha', 'bahut khoon', 'khoon ki ulti']
  },
  unconscious: {
    label: 'Unconscious / not responding / fainted',
    kw: ['unconscious', 'fainted', 'passed out', 'not responding', 'unresponsive', 'collapsed',
      'ബോധം പോയി', 'ബോധക്ഷയം', 'ബോധമില്ല', 'bodham poyi', 'bodhamilla', 'bodham kettu',
      'बेहोश', 'होश नहीं', 'behosh', 'hosh nahi']
  },
  suicidal: {
    label: 'Thoughts of suicide or self-harm',
    helpline: true,
    kw: ['suicide', 'suicidal', 'kill myself', 'end my life', 'want to die', 'self harm', 'self-harm', 'hurt myself',
      'ആത്മഹത്യ', 'മരിക്കണം', 'ജീവിക്കാൻ ആഗ്രഹമില്ല', 'athmahathya', 'aathmahathya', 'marikkanam', 'chakanam',
      'आत्महत्या', 'मरना चाहता', 'मरना चाहती', 'खुद को नुकसान', 'khudkushi', 'atmahatya', 'marna chahta', 'marna chahti']
  },
  seizure: {
    label: 'Seizure / fits',
    kw: ['seizure', 'convulsion', 'fits', 'fitting',
      'അപസ്മാരം', 'ചുഴലി', 'apasmaram', 'fits vannu', 'chuzhali',
      'दौरा पड़', 'मिर्गी', 'mirgi', 'daura pada']
  },
  poisoning: {
    label: 'Poisoning or overdose',
    kw: ['poison', 'overdose', 'swallowed', 'snake bite', 'snakebite',
      'വിഷം', 'പാമ്പ് കടിച്ചു', 'visham', 'paambu kadichu', 'pambu kadichu',
      'ज़हर', 'जहर', 'सांप ने काटा', 'zeher', 'zehar', 'saanp ne kaata']
  },
  allergy: {
    label: 'Severe allergic reaction (swelling of face / throat)',
    kw: ['throat swelling', 'throat closing', 'swollen tongue', 'severe allergic', 'anaphylaxis',
      'തൊണ്ട വീർക്കുന്നു', 'നാവ് വീർത്തു', 'thonda veerkkunnu',
      'गला सूज', 'जीभ सूज', 'gala sooj']
  }
};

// Symptom groups used by follow-up rules
export const GROUPS = {
  fever: ['fever', 'temperature', 'feverish', 'പനി', 'ജ്വരം', 'pani', 'jwaram', 'बुखार', 'ताप', 'bukhar', 'bukhaar', 'taap'],
  high_fever: ['high fever', 'very high temperature', '104', '103', 'കടുത്ത പനി', 'kadutha pani', 'തീവ്രമായ പനി', 'तेज बुखार', 'तेज़ बुखार', 'tez bukhar', 'tej bukhar'],
  infant: ['infant', 'newborn', 'baby', 'month old', 'months old', 'കുഞ്ഞ്', 'കുഞ്ഞിന്', 'നവജാത', 'kunju', 'kunjinu', 'शिशु', 'नवजात', 'shishu', 'navjaat'],
  bleeding: ['bleeding', 'blood', 'spotting', 'രക്തം', 'ചോര', 'raktham', 'chora', 'खून', 'रक्त', 'khoon'],
  abdominal_pain: ['abdominal pain', 'stomach pain', 'belly pain', 'വയറുവേദന', 'വയറ് വേദന', 'vayaru vedana', 'vayaruvedana', 'पेट दर्द', 'पेट में दर्द', 'pet dard', 'pet me dard'],
  severe_headache: ['worst headache', 'severe headache', 'blurred vision', 'കടുത്ത തലവേദന', 'kadutha thalavedana', 'तेज सिरदर्द', 'tez sir dard'],
  breathing_mild: ['breathless', 'breathing', 'wheezing', 'കിതപ്പ്', 'kithappu', 'सांस', 'saans']
};

// Extra speciality keywords (ids match the seeded specialities)
export const SPECIALITY_KEYWORDS = {
  general_physician: ['fever', 'cold', 'body pain', 'tired', 'weakness', 'vomiting', 'പനി', 'ജലദോഷം', 'ദേഹവേദന', 'ക്ഷീണം', 'ഛർദ്ദി', 'pani', 'jaladosham', 'dehavedana', 'ksheenam', 'chardi',
    'बुखार', 'जुकाम', 'बदन दर्द', 'थकान', 'कमजोरी', 'उल्टी', 'bukhar', 'zukam', 'badan dard', 'thakan', 'kamzori', 'ulti'],
  pulmonology: ['cough', 'asthma', 'wheezing', 'breathless', 'ചുമ', 'ആസ്ത്മ', 'കിതപ്പ്', 'chuma', 'aasthma', 'kithappu', 'खांसी', 'दमा', 'khansi', 'khaansi', 'dama'],
  ent: ['ear pain', 'throat pain', 'sore throat', 'sinus', 'blocked nose', 'ചെവിവേദന', 'ചെവി വേദന', 'തൊണ്ടവേദന', 'മൂക്കടപ്പ്', 'chevi vedana', 'thonda vedana', 'mookkadappu',
    'कान दर्द', 'कान में दर्द', 'गले में दर्द', 'नाक बंद', 'kaan dard', 'gala dard', 'gale me dard', 'naak band'],
  cardiology: ['palpitations', 'blood pressure', 'high bp', 'heart', 'നെഞ്ചിടിപ്പ്', 'രക്തസമ്മർദ്ദം', 'ഹൃദയം', 'nenjidippu', 'pressure koodi', 'bp koodi', 'धड़कन', 'रक्तचाप', 'दिल', 'dhadkan', 'bp high'],
  dermatology: ['rash', 'itching', 'skin', 'pimples', 'acne', 'hair fall', 'ചൊറിച്ചിൽ', 'തൊലി', 'മുഖക്കുരു', 'മുടി കൊഴിച്ചിൽ', 'chorichil', 'mukhakkuru', 'mudi kozhichil',
    'खुजली', 'त्वचा', 'मुंहासे', 'बाल झड़', 'khujli', 'muhase', 'baal jhad'],
  pediatrics: ['child', 'kid', 'baby', 'infant', 'കുട്ടി', 'കുഞ്ഞ്', 'kutti', 'kunju', 'बच्चा', 'बच्चे', 'शिशु', 'baccha', 'bachcha', 'shishu'],
  orthopedics: ['joint pain', 'back pain', 'knee pain', 'fracture', 'sprain', 'സന്ധിവേദന', 'നടുവേദന', 'മുട്ടുവേദന', 'എല്ല് ഒടിഞ്ഞു', 'sandhi vedana', 'naduvedana', 'nadu vedana', 'muttu vedana', 'ellu odinju',
    'जोड़ों में दर्द', 'कमर दर्द', 'घुटने में दर्द', 'घुटनों में दर्द', 'घुटनों का दर्द', 'घुटने का दर्द', 'घुटना दर्द', 'ghutno me dard', 'ghutna dard', 'കാൽമുട്ട് വേദന', 'kalmuttu vedana', 'हड्डी टूट', 'jodon me dard', 'kamar dard', 'ghutne me dard', 'haddi toot'],
  neurology: ['headache', 'migraine', 'dizziness', 'numbness', 'tingling', 'തലവേദന', 'തലകറക്കം', 'തരിപ്പ്', 'thalavedana', 'thala vedana', 'thalakarakkam', 'tharippu',
    'सिरदर्द', 'सिर दर्द', 'चक्कर', 'सुन्नपन', 'sir dard', 'sirdard', 'chakkar', 'sunnapan'],
  gastroenterology: ['stomach pain', 'acidity', 'gas', 'diarrhea', 'diarrhoea', 'constipation', 'വയറുവേദന', 'നെഞ്ചെരിച്ചിൽ', 'വയറിളക്കം', 'മലബന്ധം', 'vayaru vedana', 'nenjerichil', 'vayarilakkam', 'malabandham',
    'पेट दर्द', 'जलन', 'दस्त', 'कब्ज', 'pet dard', 'jalan', 'dast', 'kabz'],
  gynecology: ['periods', 'menstrual', 'pregnancy', 'pregnant', 'white discharge', 'ആർത്തവം', 'ഗർഭം', 'aarthavam', 'garbham', 'माहवारी', 'पीरियड', 'गर्भ', 'mahavari', 'garbh']
};
