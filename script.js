/* --- KONFIGURATION --- */
let bluetoothDevice;
let characteristic;
const serviceUUID = 0xFFE0;
const charUUID = 0xFFE1;

/* --- UI ELEMENTE --- */
const els = {
    layoutPS4: document.getElementById('layout-ps4'),
    layoutWheel: document.getElementById('layout-wheel'),
    layoutAuto: document.getElementById('layout-auto'),
    modal: document.getElementById('settings-modal'),
    wheel: document.getElementById('steering-wheel'),
    speed: document.getElementById('speed-display'),
    status: document.getElementById('connection-status'),
    gauge: document.querySelector('.gauge')
};

// Aktueller Status
let currentSpeed = 0;
let lastCmd = 'S';

/* --- BLUETOOTH (Wie gehabt) --- */
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
        
        // Empfang starten
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleNotifications);

        els.status.innerText = "ONLINE";
        els.status.classList.add('connected');
        document.getElementById('btn-connect').style.display = 'none';
    } catch (err) { console.error(err); els.status.innerText = "FEHLER"; }
}

function onDisconnected() {
    els.status.innerText = "OFFLINE";
    els.status.classList.remove('connected');
    document.getElementById('btn-connect').style.display = 'block';
}

function handleNotifications(event) {
    const dec = new TextDecoder();
    const val = parseFloat(dec.decode(event.target.value));
    if(!isNaN(val)) updateTacho(val);
}

function updateTacho(val) {
    els.speed.innerText = val.toFixed(1);
    let pct = (val / 2.0) * 100; // Annahme: Max 2 m/s
    if(pct>100) pct=100;
    els.gauge.style.background = `conic-gradient(#00e5ff ${pct}%, #333 ${pct}%)`;
}

async function send(cmd) {
    if(cmd === lastCmd) return; // Nicht spammen
    lastCmd = cmd;
    
    if(navigator.vibrate && cmd !== 'S') navigator.vibrate(10);
    if(!characteristic) return;
    try {
        await characteristic.writeValue(new TextEncoder().encode(cmd));
    } catch(e) { console.log(e); }
}

/* --- EINSTELLUNGEN --- */
function toggleSettings() {
    els.modal.classList.toggle('hidden');
}

function changeLayout() {
    const mode = document.getElementById('mode-selector').value;
    // Alles ausblenden
    els.layoutPS4.classList.add('hidden');
    els.layoutWheel.classList.add('hidden');
    els.layoutAuto.classList.add('hidden');

    // Gewähltes einblenden
    if(mode === 'ps4') els.layoutPS4.classList.remove('hidden');
    if(mode === 'wheel') els.layoutWheel.classList.remove('hidden');
    if(mode === 'auto') els.layoutAuto.classList.remove('hidden');
    
    toggleSettings();
}


/* --- LOGIK: VIRTUAL JOYSTICK (PS4) --- */
class VirtualJoystick {
    constructor(elementId, type) {
        this.knob = document.getElementById(elementId);
        this.base = this.knob.parentElement;
        this.type = type; // 'drive' oder 'steer'
        this.active = false;
        this.startX = 0; this.startY = 0;
        
        // Touch Events binden
        this.base.addEventListener('touchstart', (e) => this.start(e), {passive: false});
        this.base.addEventListener('touchmove', (e) => this.move(e), {passive: false});
        this.base.addEventListener('touchend', () => this.end());
    }

    start(e) {
        e.preventDefault();
        this.active = true;
        this.startX = e.touches[0].clientX;
        this.startY = e.touches[0].clientY;
    }

    move(e) {
        if(!this.active) return;
        e.preventDefault();
        
        const deltaX = e.touches[0].clientX - this.startX;
        const deltaY = e.touches[0].clientY - this.startY;
        
        // Begrenzung des Knobs (visuell)
        const limit = 30; 
        const dist = Math.sqrt(deltaX*deltaX + deltaY*deltaY);
        let x = deltaX; let y = deltaY;
        
        if(dist > limit) {
            x = (deltaX / dist) * limit;
            y = (deltaY / dist) * limit;
        }

        this.knob.style.transform = `translate(${x}px, ${y}px)`;

        // Logik für Befehle (Threshold 15px)
        if(this.type === 'drive') {
            if(y < -15) send('F');
            else if(y > 15) send('B');
            else send('S');
        } else if (this.type === 'steer') {
            if(x < -15) send('L');
            else if(x > 15) send('R');
            else send('S'); // Wichtig: Geradeaus wenn losgelassen
        }
    }

    end() {
        this.active = false;
        this.knob.style.transform = `translate(0px, 0px)`;
        send('S');
    }
}

// Joysticks initialisieren
new VirtualJoystick('stick-left', 'drive');
new VirtualJoystick('stick-right', 'steer');


/* --- LOGIK: LENKRAD (RACING) --- */
const wheel = els.wheel;
let wheelActive = false;

wheel.addEventListener('touchstart', (e) => {
    e.preventDefault(); wheelActive = true;
}, {passive:false});

wheel.addEventListener('touchmove', (e) => {
    if(!wheelActive) return;
    e.preventDefault();
    
    const rect = wheel.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const touchX = e.touches[0].clientX;
    const touchY = e.touches[0].clientY;

    // Winkel berechnen
    const angleRad = Math.atan2(touchY - centerY, touchX - centerX);
    let angleDeg = angleRad * (180 / Math.PI);
    
    // Korrektur, damit oben 0 ist (atan2 ist rechts 0)
    angleDeg += 90; 

    // Visuell drehen (Begrenzt auf +/- 90 Grad)
    if(angleDeg > 90) angleDeg = 90;
    if(angleDeg < -90) angleDeg = -90;
    
    wheel.style.transform = `rotate(${angleDeg}deg)`;

    // Befehle senden
    if(angleDeg < -20) send('L');
    else if(angleDeg > 20) send('R');
    else send('S'); // Geradeaus in der Mitte
}, {passive:false});

wheel.addEventListener('touchend', () => {
    wheelActive = false;
    wheel.style.transform = `rotate(0deg)`; // Auto-Center
    send('S');
});

// Pedale
const gas = document.getElementById('pedal-gas');
const brake = document.getElementById('pedal-brake');

const bindPedal = (elem, cmd) => {
    elem.addEventListener('touchstart', (e) => { e.preventDefault(); elem.classList.add('active'); send(cmd); });
    elem.addEventListener('touchend', (e) => { e.preventDefault(); elem.classList.remove('active'); send('S'); });
};

bindPedal(gas, 'F');
bindPedal(brake, 'B');