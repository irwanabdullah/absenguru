const SS = SpreadsheetApp.getActiveSpreadsheet();
const SHEET_GURU = SS.getSheetByName("guru");
const SHEET_ABSEN = SS.getSheetByName("absen");

// --- KONFIGURASI SEKOLAH ---
const LAT_SEKOLAH = -5.170580; 
const LONG_SEKOLAH = 119.44962;
const RADIUS_MAKSIMAL = 200; 

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result;

    if (action === "login") {
      result = loginGuru(data.nip, data.pass);
    } else if (action === "upload") {
      result = updateFoto(data.nip, data.foto);
    } else if (action === "absen") {
      result = submitAbsen(data.nip, data.lat, data.long);
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({success: false, msg: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function loginGuru(nip, pass) {
  const values = SHEET_GURU.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][1].toString() === nip.toString() && values[i][2].toString() === pass.toString()) {
      return { success: true, nama: values[i][0], nip: values[i][1], foto: values[i][3] || "" };
    }
  }
  return { success: false, msg: "NIP atau Password salah!" };
}

function updateFoto(nip, base64Data) {
  const values = SHEET_GURU.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][1].toString() === nip.toString()) {
      SHEET_GURU.getRange(i + 1, 4).setValue(base64Data);
      return { success: true };
    }
  }
  return { success: false };
}

function submitAbsen(nip, latUser, longUser) {
  // Gunakan Lock untuk mencegah data tumpang tindih
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // Tunggu maksimal 10 detik

    // 1. Cek apakah sudah absen hari ini
    if (isAlreadyCheckedIn(nip)) {
      return { success: false, msg: "Anda sudah absen hari ini!" };
    }

    // 2. Cek Radius
    const dist = getDistance(latUser, longUser, LAT_SEKOLAH, LONG_SEKOLAH);
    if (dist > RADIUS_MAKSIMAL) {
      return { success: false, msg: "Di luar radius! Jarak: " + Math.round(dist) + "m" };
    }

    // 3. Ambil Nama
    const values = SHEET_GURU.getDataRange().getValues();
    let nama = "";
    for (let i = 1; i < values.length; i++) {
      if (values[i][1].toString() === nip.toString()) {
        nama = values[i][0];
        break;
      }
    }

    // 4. Simpan ke Spreadsheet
    const waktuSekarang = new Date();
    SHEET_ABSEN.appendRow([
      nama, 
      nip.toString(), 
      waktuSekarang, 
      "Hadir", 
      Math.round(dist) + "m"
    ]);

    // Pastikan perubahan tersimpan
    SpreadsheetApp.flush();
    return { success: true, msg: "Absen Berhasil!" };

  } catch (e) {
    return { success: false, msg: "Kesalahan Server: " + e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function isAlreadyCheckedIn(nip) {
  const dataAbsen = SHEET_ABSEN.getDataRange().getValues();
  if (dataAbsen.length <= 1) return false; 

  const today = new Date();
  const tz = SS.getSpreadsheetTimeZone(); 
  const todayStr = Utilities.formatDate(today, tz, "yyyy-MM-dd");

  // Loop mulai dari baris kedua (index 1)
  for (let i = 1; i < dataAbsen.length; i++) {
    // Paksa semua menjadi string agar perbandingannya adil
    const rowNip = String(dataAbsen[i][1]).trim(); 
    const rowDateRaw = dataAbsen[i][2]; 
    
    let rowDateStr = "";
    if (rowDateRaw instanceof Date) {
      rowDateStr = Utilities.formatDate(rowDateRaw, tz, "yyyy-MM-dd");
    } else if (rowDateRaw !== "") {
      // Jika format di sheet bukan 'Date', coba ubah paksa
      rowDateStr = Utilities.formatDate(new Date(rowDateRaw), tz, "yyyy-MM-dd");
    }
    
    // LOG UNTUK DEBUG (Bisa dilihat di menu Executions)
    console.log("Cek Baris " + (i+1) + ": Mencari " + nip + " vs " + rowNip + " | Tanggal: " + todayStr + " vs " + rowDateStr);

    if (rowNip === String(nip).trim() && rowDateStr === todayStr) {
      return true; 
    }
  }
  return false;
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Fungsi untuk mengambil semua data absen (khusus Admin)
function getRekapAbsen() {
  const values = SHEET_ABSEN.getDataRange().getValues();
  if (values.length <= 1) return []; // Jika kosong
  
  const header = values[0]; // Nama kolom dari baris 1
  const rows = values.slice(1);
  const tz = SS.getSpreadsheetTimeZone();
  
  return rows.map(row => {
    let obj = {};
    header.forEach((key, i) => {
      let val = row[i];
      // Jika tipe data adalah tanggal (Date), format ke string agar aman dikirim
      if (val instanceof Date) {
        val = Utilities.formatDate(val, tz, "yyyy-MM-dd HH:mm:ss");
      }
      // Simpan ke objek dengan kunci yang sudah dibersihkan spasi-nya
      obj[key.toString().trim()] = val;
    });
    return obj;
  });
}

// Tambahkan "getRekap" ke dalam doPost agar bisa diakses fetch
// Update bagian doPost Anda menjadi seperti ini:
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const action = data.action;
  let result;

  if (action === "login") {
    result = loginGuru(data.nip, data.pass);
  } else if (action === "upload") {
    result = updateFoto(data.nip, data.foto);
  } else if (action === "absen") {
    result = submitAbsen(data.nip, data.lat, data.long);
  } else if (action === "getRekap") { // <-- Tambahan untuk Admin
    result = getRekapAbsen();
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}