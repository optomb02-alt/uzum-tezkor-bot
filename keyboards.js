import { Markup } from 'telegraf';

export const CITIES = ['Toshkent', 'Samarqand', 'Namangan', 'Andijon', 'Farg\'ona', 'Buxoro'];
export const TRANSPORTS = ['Avto', 'Moto', 'Elektrovelo', 'Velo'];

/**
 * Calculates the next 5 weekdays (Monday to Friday) starting from tomorrow.
 * Returns an array of objects: { name: "Payshanba (02.07.2026)", value: "2026-07-02" }
 */
export function getNext5WorkingDays() {
  const days = [];
  const dayNamesUz = {
    1: 'Dushanba',
    2: 'Seshanba',
    3: 'Chorshanba',
    4: 'Payshanba',
    5: 'Juma'
  };
  
  // Start checking from tomorrow based on Tashkent time (UTC+5)
  const nowUtc = Date.now();
  const tashkentOffsetMs = 5 * 60 * 60 * 1000;
  const current = new Date(nowUtc + tashkentOffsetMs);
  current.setUTCDate(current.getUTCDate() + 1);
  
  // Safe limit to prevent infinite loop
  let iterations = 0;
  while (days.length < 5 && iterations < 15) {
    iterations++;
    const dayOfWeek = current.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      const d = String(current.getUTCDate()).padStart(2, '0');
      const m = String(current.getUTCMonth() + 1).padStart(2, '0');
      const y = current.getUTCFullYear();
      
      const dateStr = `${d}.${m}.${y}`;
      const valueStr = `${y}-${m}-${d}`;
      const name = `${dayNamesUz[dayOfWeek]} (${dateStr})`;
      
      days.push({ name, value: valueStr });
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

export function getTransportInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚗 Avto', 'transport_Avto'), Markup.button.callback('🏍️ Moto', 'transport_Moto')],
    [Markup.button.callback('🚲 Elektrovelo', 'transport_Elektrovelo'), Markup.button.callback('🚲 Velo', 'transport_Velo')]
  ]);
}

export function getCityInlineKeyboard() {
  const buttons = CITIES.map(city => Markup.button.callback(city, `city_${city}`));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return Markup.inlineKeyboard(rows);
}

export function getPhoneKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest('📱 Telefon raqamni yuborish')]
  ]).resize().oneTime();
}

export function getTrainingDatesInlineKeyboard() {
  const dates = getNext5WorkingDays();
  const buttons = dates.map(d => [Markup.button.callback(d.name, `date_${d.value}_${d.name}`)]);
  return Markup.inlineKeyboard(buttons);
}

export const CITY_LOCATIONS = {
  'Toshkent': {
    title: 'Uzum Tezkor Trening Markazi (Toshkent)',
    address: 'Toshkent sh., Mirobod tumani, Nukus ko\'chasi, 29 (Mo\'ljal: Rossiya elchixonasi yonida)',
    latitude: 41.2935,
    longitude: 69.2785,
    mapUrl: 'https://yandex.uz/maps/-/CDuXeM2V'
  },
  'Samarqand': {
    title: 'Uzum Tezkor Trening Markazi (Samarqand)',
    address: 'Samarqand sh., Mirzo Ulug\'bek ko\'chasi, 45 (Mo\'ljal: Markaziy xiyobon)',
    latitude: 39.6542,
    longitude: 66.9597,
    mapUrl: 'https://yandex.uz/maps/-/CDuXe801'
  },
  'Namangan': {
    title: 'Uzum Tezkor Trening Markazi (Namangan)',
    address: 'Namangan sh., Alisher Navoiy ko\'chasi, 12 (Mo\'ljal: Chorsu bozori yaqinida)',
    latitude: 40.9983,
    longitude: 71.6726,
    mapUrl: 'https://yandex.uz/maps/-/CDuXeD5z'
  },
  'Andijon': {
    title: 'Uzum Tezkor Trening Markazi (Andijon)',
    address: 'Andijon sh., Amir Temur shoh ko\'chasi, 10 (Mo\'ljal: Eski shahar)',
    latitude: 40.7821,
    longitude: 72.3442,
    mapUrl: 'https://yandex.uz/maps/-/CDuXeH28'
  },
  'Farg\'ona': {
    title: 'Uzum Tezkor Trening Markazi (Farg\'ona)',
    address: 'Farg\'ona sh., Al-Farg\'oniy ko\'chasi, 25 (Mo\'ljal: Viloyat teatri ro\'parasida)',
    latitude: 40.3864,
    longitude: 71.7864,
    mapUrl: 'https://yandex.uz/maps/-/CDuXeP9k'
  },
  'Buxoro': {
    title: 'Uzum Tezkor Trening Markazi (Buxoro)',
    address: 'Buxoro sh., Ibrohim Mo\'minov ko\'chasi, 8 (Mo\'ljal: Karvon bozori yonida)',
    latitude: 39.7747,
    longitude: 64.4286,
    mapUrl: 'https://yandex.uz/maps/-/CDuXeT3w'
  }
};

export function getCityOffice(city) {
  return CITY_LOCATIONS[city] || CITY_LOCATIONS['Toshkent'];
}

export function getUzbekDayName(dateStr) {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();
    const dayNamesUz = {
      1: 'Dushanba',
      2: 'Seshanba',
      3: 'Chorshanba',
      4: 'Payshanba',
      5: 'Juma',
      6: 'Shanba',
      0: 'Yakshanba'
    };
    const d = String(day).padStart(2, '0');
    const m = String(month).padStart(2, '0');
    return `${dayNamesUz[dayOfWeek] || 'Trening'} (${d}.${m}.${year})`;
  } catch (err) {
    return dateStr;
  }
}

