// ============================================
// AYARLAR
// ============================================

# const GEMINI_API_KEY = 'Gemini API Anahtarı Buraya';
#const SPREADSHEET_ID = 'Google Spreadsheet ID Buraya';

// ============================================
// ANA FONKSİYON - SADECE YENİ SATIRLARI ANALİZ ET
// ============================================

function analyzeNewRows() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const hamVeriSheet = ss.getSheetByName('Ham Veri');
  const aiAnalizSheet = ss.getSheetByName('AI Analizi');
  
  if (!hamVeriSheet || !aiAnalizSheet) {
    Logger.log('❌ Sayfalar bulunamadı');
    return;
  }

  // Ham Veri'deki son satır numarasını al
  const hamVeriLastRow = hamVeriSheet.getLastRow();
  
  // AI Analizi'ndeki son dolu satır numarasını al
  const aiAnalizLastRow = aiAnalizSheet.getLastRow();
  
  // Eğer yeni satır yoksa çık
  if (hamVeriLastRow <= aiAnalizLastRow) {
    Logger.log(`✅ Yeni veri yok. Ham Veri: ${hamVeriLastRow}, AI Analizi: ${aiAnalizLastRow}`);
    return;
  }
  
  // Yeni satırları işle
  const startRow = aiAnalizLastRow + 1; // Bir sonraki işlenecek satır
  const endRow = hamVeriLastRow;
  
  Logger.log(`\n📊 ${endRow - startRow + 1} yeni öneri bulundu! (Satır ${startRow}-${endRow})`);
  
  for (let i = startRow; i <= endRow; i++) {
    const row = hamVeriSheet.getRange(i, 1, 1, 6).getValues()[0];
    
    // Satır boşsa atla
    if (!row[3] || row[3].toString().trim() === '') {
      Logger.log(`⏭️ Satır ${i} boş, atlanıyor`);
      continue;
    }
    
    const departman = row[1];      // B sütunu
    const kategoriUser = row[2];   // C sütunu
    const oneriMetni = row[3];     // D sütunu
    const aciliyetUser = row[4];   // E sütunu
    
    Logger.log(`\n🔄 Analiz: Satır ${i}`);
    Logger.log(`   Departman: ${departman}`);
    Logger.log(`   Öneri: ${oneriMetni.substring(0, 50)}...`);
    
    // Gemini'ye prompt hazırla
    const prompt = buildPrompt(departman, kategoriUser, oneriMetni, aciliyetUser);
    
    // Gemini API'yi çağır (retry ile)
    const aiResponse = callGeminiAPIWithRetry(prompt);
    
    if (!aiResponse) {
      Logger.log(`   ❌ AI yanıtı alınamadı, satır atlanıyor`);
      
      // Boş satır ekle (sırayı kaçırmamak için)
      aiAnalizSheet.getRange(i, 1, 1, 9).setValues([[
        'İşlenemedi', 0, 'N/A', 'N/A', 0, '', 'N/A', 0, 'API hatası'
      ]]);
      continue;
    }
    
    // JSON parse et
    const analysisData = parseGeminiResponse(aiResponse);
    
    // AI Analizi sayfasına yaz
    if (analysisData) {
      aiAnalizSheet.getRange(i, 1, 1, 9).setValues([[
        analysisData.kategori,
        analysisData.aciliyet_skoru,
        analysisData.uygulama_zorlugu,
        analysisData.maliyet_tahmini,
        analysisData.etkilenen_kisi,
        analysisData.anahtar_kelimeler,
        analysisData.sentiment,
        analysisData.oncelik_puani,
        analysisData.kisa_ozet
      ]]);
      
      Logger.log(`   ✅ Satır ${i} tamamlandı - Öncelik: ${analysisData.oncelik_puani}/100`);
    } else {
      Logger.log(`   ❌ Satır ${i} parse edilemedi`);
      
      // Hata satırı ekle
      aiAnalizSheet.getRange(i, 1, 1, 9).setValues([[
        'Parse Hatası', 0, 'N/A', 'N/A', 0, '', 'N/A', 0, 'JSON parse başarısız'
      ]]);
    }
    
    // Rate limit için bekle (5 saniye)
    Utilities.sleep(5000);
  }
  
  Logger.log(`\n🎉 ${endRow - startRow + 1} yeni öneri işlendi!`);
}

// ============================================
// YARDIMCI FONKSİYONLAR
// ============================================

function buildPrompt(departman, kategori, oneri, aciliyet) {
  return `Çalışan önerisi analizi - Sadece JSON döndür:
DEPARTMAN: ${departman}
ÖNERİ: ${oneri}
ACİLİYET: ${aciliyet}/5
Analiz kriterleri:
1. kategori: Teknik/Altyapı, Süreç Optimizasyonu, İletişim/Kültür, Eğitim/Gelişim, Çalışma Koşulları
2. aciliyet_skoru: 1-10
3. uygulama_zorlugu: Kolay/Orta/Zor
4. maliyet_tahmini: Düşük/Orta/Yüksek
5. etkilenen_kisi: Sayı
6. anahtar_kelimeler: 3-5 kelime array
7. sentiment: Pozitif/Nötr/Negatif
8. oncelik_puani: 1-100
9. kisa_ozet: Max 30 kelime
JSON çıktı:
{
  "kategori": "string", "aciliyet_skoru": 8, "uygulama_zorlugu": "Orta",
  "maliyet_tahmini": "Yüksek", "etkilenen_kisi": 25,
  "anahtar_kelimeler": ["test", "otomasyon"], "sentiment": "Pozitif",
  "oncelik_puani": 75, "kisa_ozet": "string"
}`;
}

function callGeminiAPIWithRetry(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const payload = { 
    contents: [{ parts: [{ text: prompt }] }], 
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 } 
  };
  const options = { 
    method: 'post', 
    contentType: 'application/json', 
    payload: JSON.stringify(payload), 
    muteHttpExceptions: true 
  };
  
  // 3 deneme yap
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      
      // Rate limit hatası (429)
      if (responseCode === 429) {
        Logger.log(`   ⚠️ Rate limit (429) - Deneme ${attempt}/3`);
        if (attempt < 3) {
          const waitTime = attempt * 10000; // 10, 20, 30 saniye
          Logger.log(`   ⏳ ${waitTime/1000} saniye bekleniyor...`);
          Utilities.sleep(waitTime);
          continue;
        } else {
          Logger.log(`   ❌ Rate limit aşıldı, vazgeçiliyor`);
          return null;
        }
      }
      
      // Diğer hatalar
      if (responseCode !== 200) { 
        Logger.log(`   ❌ API Hatası: ${responseCode}`); 
        if (attempt < 3) {
          Utilities.sleep(5000);
          continue;
        }
        return null; 
      }
      
      // Başarılı yanıt
      const result = JSON.parse(response.getContentText());
      if (!result.candidates || !result.candidates[0].content || !result.candidates[0].content.parts) { 
        Logger.log(`   ❌ Yanıt formatı hatalı`);
        return null;
      }
      
      Logger.log(`   ✅ AI yanıtı alındı`);
      return result.candidates[0].content.parts[0].text;
      
    } catch (error) {
      Logger.log(`   ❌ Hata (Deneme ${attempt}/3): ${error.message}`);
      if (attempt < 3) {
        Utilities.sleep(5000);
      }
    }
  }
  
  return null; // Tüm denemeler başarısız
}

function parseGeminiResponse(aiText) {
  if (!aiText) return null;
  try {
    let cleanedText = aiText.replace(/```json\n?|\n?```/g, '').trim();
    cleanedText = cleanedText.replace(/^```\n?|\n?```$/g, '').trim();
    
    const jsonData = JSON.parse(cleanedText);
    
    if (Array.isArray(jsonData.anahtar_kelimeler)) { 
      jsonData.anahtar_kelimeler = jsonData.anahtar_kelimeler.join(', '); 
    }
    
    jsonData.kategori = jsonData.kategori || 'Belirtilmemiş';
    jsonData.aciliyet_skoru = jsonData.aciliyet_skoru || 5;
    jsonData.uygulama_zorlugu = jsonData.uygulama_zorlugu || 'Orta';
    jsonData.maliyet_tahmini = jsonData.maliyet_tahmini || 'Orta';
    jsonData.etkilenen_kisi = jsonData.etkilenen_kisi || 0;
    jsonData.sentiment = jsonData.sentiment || 'Nötr';
    jsonData.oncelik_puani = jsonData.oncelik_puani || 50;
    jsonData.kisa_ozet = jsonData.kisa_ozet || 'Özet oluşturulamadı';
    
    return jsonData;
  } catch (error) {
    Logger.log(`   ❌ JSON Parse Hatası: ${error.message}`);
    return null;
  }
}

// ============================================
// TETİKLEYİCİ YÖNETİMİ
// ============================================

function setupAutoAnalysis() {
  // Önce mevcut tetikleyicileri temizle
  stopAutoAnalysis();
  
  // Yeni tetikleyici oluştur: Her 10 dakikada çalış
  ScriptApp.newTrigger('analyzeNewRows')
    .timeBased()
    .everyMinutes(10)
    .create();
  
  Logger.log('✅ Otomatik analiz tetikleyicisi kuruldu (10 dakikada bir)');
  
  // İlk çalıştırma
  analyzeNewRows();
  
  // UI bildirimi
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert('🤖 Otomasyon Aktif!', 
      'Sistem her 10 dakikada yeni önerileri otomatik analiz edecek.\n\n' +
      '✅ Form doldurulur → Ham Veri\n' +
      '✅ Her 10 dakika → Yeni satırlar analiz edilir\n' +
      '✅ Sonuçlar → AI Analizi sayfasına yazılır\n\n' +
      'Durdurmak için: 🤖 AI Analizi → ⏹️ Otomasyonu Durdur', 
      ui.ButtonSet.OK);
  } catch (e) {
    Logger.log('Otomasyon kuruldu (UI yok)');
  }
}

function stopAutoAnalysis() {
  const allTriggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < allTriggers.length; i++) {
    if (allTriggers[i].getHandlerFunction() === 'analyzeNewRows') { 
      ScriptApp.deleteTrigger(allTriggers[i]); 
      Logger.log('🗑️ Eski tetikleyici silindi');
    }
  }
  
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert('⏹️ Otomasyon Durduruldu', 
      'Otomatik analiz sistemi kapatıldı.\n\n' +
      'Tekrar başlatmak için: 🤖 AI Analizi → ▶️ Otomasyonu Başlat', 
      ui.ButtonSet.OK);
  } catch (e) {
    Logger.log('Otomasyon durduruldu (UI yok)');
  }
}

// ============================================
// MENÜ
// ============================================

function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('🤖 AI Analizi')
        .addItem('▶️ Otomasyonu Başlat', 'setupAutoAnalysis')
        .addItem('⏹️ Otomasyonu Durdur', 'stopAutoAnalysis')
        .addSeparator()
        .addItem('🔄 Şimdi Kontrol Et', 'analyzeNewRows')
        .addItem('🧪 Test (Tek Satır)', 'testSingleRow')
        .addToUi();
  } catch (error) {
    Logger.log(`❌ Menü oluşturulamadı: ${error.message}`);
  }
}

// ============================================
// TEST FONKSİYONU
// ============================================

function testSingleRow() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const hamVeriSheet = ss.getSheetByName('Ham Veri');

  if (!hamVeriSheet) {
    Logger.log('❌ "Ham Veri" sayfası bulunamadı!');
    return;
  }
  
  const lastRow = hamVeriSheet.getLastRow();
  const row = hamVeriSheet.getRange(lastRow, 1, 1, 6).getValues()[0];
  
  Logger.log('🧪 TEST - EN SON ÖNERİ ANALİZ EDİLİYOR...\n');
  Logger.log(`Satır: ${lastRow}`);
  Logger.log(`Departman: ${row[1]}`);
  Logger.log(`Öneri: ${row[3]}\n`);
  
  const prompt = buildPrompt(row[1], row[2], row[3], row[4]);
  const aiResponse = callGeminiAPIWithRetry(prompt);
  
  if (!aiResponse) {
    Logger.log('❌ Test başarısız');
    return;
  }
  
  const parsed = parseGeminiResponse(aiResponse);
  
  if (parsed) {
    Logger.log('✅ TEST BAŞARILI!');
    Logger.log(`   Kategori: ${parsed.kategori}`);
    Logger.log(`   Öncelik: ${parsed.oncelik_puani}/100`);
    Logger.log(`   Özet: ${parsed.kisa_ozet}`);
  } else {
    Logger.log('❌ Parse başarısız');
  }
}
