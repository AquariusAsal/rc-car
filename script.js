/* * RC FPV Controller Logic
 * Support: Web Bluetooth, Gamepad API, Touch Events
 */

// --- GLOBALS ---
let bluetoothDevice;
let characteristic;
const serviceUUID = 0xFFE0; // Standard HM-10 UUID
const charUUID = 0xFFE1;

let lastCmd = 'S';
let currentMode = 'ps4';
let wheelActive = false;
let gamepadIndex = null;

// UI Caching
const els = {
    status: document.getElementById('connection-status'),
    speed: document.getElementById('speed-display'),
    gauge: document.querySelector('.gauge'),
    layouts: {
        ps4: document.getElementById('layout-ps4'),
        wheel: document.getElementById('layout-wheel'),
        auto: document.getElementById('layout-auto')
    },
    modal: document.getElementById('settings-modal'),
    wheelImg: document.getElementById('steering-wheel'),
    gpStatus: document.getElementById('gamepad-status'),
    camStream: document.getElementById('camera-stream'),
    camIpInput: document.getElementById('camera-ip')
};

// --- BLUETOOTH CONNECTION ---
async function connectBluetooth() {
    try {
        els.status.innerText = "SUCHE...";
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [serviceUUID]
        });

        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
        const server = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService(serviceUUID);
        characteristic = await service.getCharacteristic(charUUID);

        // Daten Empfang starten (Tacho)
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleData);

        els.status.innerText = "SYSTEM: ONLINE";
        els.status.classList.add('connected');
        document.getElementById('btn-connect').style.display = 'none';
        
    } catch (err) {
        console.error(err);
        els.status.innerText = "FEHLER";
        alert("Bluetooth Verbindung fehlgeschlagen. Ist das Modul an?");
    }
}

function onDisconnected() {
    els.status.innerText = "SYSTEM: OFFLINE";
    els.status.classList.remove('connected');
    document.getElementById('btn-connect').style.display = 'block';
}

// --- DATEN EMPFANG & TACHO ---
function handleData(event) {
    const dec = new TextDecoder();
    const valStr = dec.decode(event.target.value);
    const speed = parseFloat(valStr);
    
    if (!isNaN(speed)) {
        updateTacho(speed);
    }
}

function updateTacho(val) {
    els.speed.innerText = val.toFixed(1);
    // Skalierung: 2.0 m/s = 100%
    let pct = (val / 2.0) * 100;
    if (pct > 100) pct = 100;
    els.gauge.style.background = `conic-gradient(#00e5ff ${pct}%, rgba(255,255,255,0.1) ${pct}%)`;
}

// --- SENDEN ---
async function send(cmd) {
    if (cmd === lastCmd) return; // Spam Filter
    lastCmd = cmd;
    
    // Haptisches Feedback
    if (navigator.vibrate && cmd !== 'S') navigator.vibrate(10);
    
    if (!characteristic) return;

    try {
        const enc = new TextEncoder();
        await characteristic.writeValue(enc.encode(cmd));
        console.log("Sent:", cmd);
    } catch (e) {
        console.warn("Sende-Fehler:", e);
    }
}

// --- KAMERA STREAM ---
function startStream() {
    const ip = els.camIpInput.value.trim();
    if (ip.length > 6) {
        // ESP32-CAM Stream URL
        els.camStream.src = `http://${ip}:81/stream`;
        localStorage.setItem('saved_cam_ip', ip);
        toggleSettings(); // Menü schließen
    } else {
        alert("Bitte gültige IP Adresse eingeben!");
    }
}

// --- GAMEPAD API LOOP ---
window.addEventListener("gamepadconnected", (e) => {
    gamepadIndex = e.gamepad.index;
    els.gpStatus.innerText = "Controller verbunden!";
    els.gpStatus.classList.add('active');
    els.gpStatus.classList.remove('pulsing');
    requestAnimationFrame(gameLoop);
});

window.addEventListener("gamepaddisconnected", () => {
    gamepadIndex = null;
    els.gpStatus.innerText = "Controller suchen...";
    els.gpStatus.classList.remove('active');
    els.gpStatus.classList.add('pulsing');
});

function gameLoop() {
    if (gamepadIndex === null || currentMode !== 'ps4') return;

    const gp = navigator.getGamepads()[gamepadIndex];
    if (gp) {
        // Sticks auslesen (mit Deadzone)
        const deadzone = 0.2;
        const axisY = gp.axes[1]; // Linker Stick hoch/runter
        const axisX = gp.axes[2]; // Rechter Stick links/rechts
        
        let cmd = 'S';

        // Priorität: Lenken > Fahren
        if (axisX < -deadzone) cmd = 'L';
        else if (axisX > deadzone) cmd = 'R';
        else if (axisY < -deadzone) cmd = 'F';
        else if (axisY > deadzone) cmd = 'B';
        
        send(cmd);
    }
    requestAnimationFrame(gameLoop);
}

// --- TOUCH LENKRAD LOGIK ---
els.wheelImg.addEventListener('touchstart', (e) => { e.preventDefault(); wheelActive = true; }, {passive:false});
els.wheelImg.addEventListener('touchend', () => { 
    wheelActive = false; 
    els.wheelImg.style.transform = `rotate(0deg)`; 
    send('S'); 
});

els.wheelImg.addEventListener('touchmove', (e) => {
    if (!wheelActive) return;
    e.preventDefault();
    
    const rect = els.wheelImg.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const touch = e.touches[0];
    
    // Winkel berechnen
    const radians = Math.atan2(touch.clientY - centerY, touch.clientX - centerX);
    let degrees = radians * (180 / Math.PI) + 90; // +90 weil Bild oben 0° ist
    
    // Limits setzen (-90 bis +90)
    if (degrees > 180) degrees = 180;
    if (degrees < 180) degrees = -180;
    
    // Bild drehen
    els.wheelImg.style.transform = `rotate(${degrees}deg)`;
    
    // Befehle senden (Threshold 20 Grad)
    if (degrees < -20) send('L');
    else if (degrees > 20) send('R');
    else send('S');
}, {passive:false});

// Pedale
const bindPedal = (id, cmd) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); el.classList.add('active'); send(cmd); });
    el.addEventListener('touchend', (e) => { e.preventDefault(); el.classList.remove('active'); send('S'); });
};
bindPedal('pedal-gas', 'F');
bindPedal('pedal-brake', 'B');


// --- UI SETTINGS ---
function toggleSettings() { els.modal.classList.toggle('hidden'); }

function changeLayout() {
    currentMode = document.getElementById('mode-selector').value;
    
    // Alle ausblenden
    Object.values(els.layouts).forEach(el => el.classList.add('hidden'));
    
    // Gewählten einblenden
    if (els.layouts[currentMode]) {
        els.layouts[currentMode].classList.remove('hidden');
    }
    
    if (currentMode === 'ps4' && gamepadIndex !== null) requestAnimationFrame(gameLoop);
}

// Init Load
window.onload = () => {
    const savedIP = localStorage.getItem('saved_cam_ip');
    if (savedIP) els.camIpInput.value = savedIP;
};