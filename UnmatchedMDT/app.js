const medMap = { 
    "Student Paramedic": [
        "Oxygen (Cardiac arrest/trauma) (GAS)", 
        "Aspirin (Suspected heart attack) 300mg (TABLET)", 
        "Codeine [supervised] (Mild to severe pain) 15mg (TABLET)", 
        "Glucose (Hypoglycemia) 50g/500ml (INFUSION)", 
        "GTN (Cardiac chest pain/Angina) 400mcg/spray (INHALER)", 
        "Ibuprofen (Mild to mod pain) 400mg (TABLET)", 
        "Ipratropium Bromide (Life threatening asthma/COPD) 250mcg/3ml (NEB)", 
        "Naproxen (Acute/chronic MSK pain) 250mg (TABLET)", 
        "Paracetamol (Mild to mod pain) 1g (TABLET)", 
        "Salbutamol (Asthma attack/COPD) 2.5mg/2.5ml (NEB)"
    ], 
    "Paramedic": [
        "Oxygen (Cardiac arrest/trauma) (GAS)", 
        "Adrenaline (Cardiac arrest) 1mg/10ml (INJ)", 
        "Amiodarone (Pulseless VT only) 300mg/10ml (INJ)", 
        "Aspirin (Suspected heart attack) 300mg (TABLET)", 
        "Atropine Sulfate (<40 pulse symptomatic) 600mcg (INJ)", 
        "Chlorphenamine (Allergic reaction) 10mg/1ml (INJ)", 
        "Codeine (Mild to severe pain) 15mg (TABLET)", 
        "Glucose (Hypoglycemia) 50g/500ml (INFUSION)", 
        "GTN (Cardiac chest pain/Angina) 400mcg/spray (INHALER)", 
        "Ibuprofen (Mild to mod pain) 400mg (TABLET)", 
        "Ipratropium Bromide (Life threatening asthma/COPD) 250mcg/3ml (NEB)", 
        "Metoclopramide (Nausea/vomiting) 10mg/2ml (INJ)", 
        "Midazolam (Seizure control) 5mg/5ml (INJ)", 
        "Morphine Sulfate (Moderate pain) 10mg/1ml (INJ)", 
        "Naloxone IV (Drug overdose) 400mcg/1ml (INJ)", 
        "Naloxone IM (Drug overdose) 400mcg/1ml (INJ)", 
        "Naproxen (Acute/chronic MSK pain) 250mg (TABLET)", 
        "Paracetamol IV (Mild to mod pain) 1000mg/100ml (INFUSION)", 
        "Paracetamol (Mild to mod pain) 1g (TABLET)", 
        "Prednisolone (Moderate acute asthma) 5mg (TABLET)", 
        "Salbutamol (Asthma attack/COPD) 2.5mg/2.5ml (NEB)", 
        "Sodium Chloride (Fluids) 500ml (INFUSION)", 
        "TXA (Major trauma/blood control) 100mg/1ml (INJ)"
    ], 
    "Advanced Paramedic": [
        "Ketamine (Severe pain management) 10mg/1ml (INJ)"
    ], 
    "HEMS": [
        "Amoxicillin (Infections) 500mg (TABLET)", 
        "Fentanyl (Pain relief) 50mcg/1ml (INJ)",
        "Rocuronium Bromide (RSI Intubation) 10mg/1ml (INJ)"
    ], 
    "Doctor": [
        "Co-amoxiclav (Open fracture infections) 1200mg (ORAL)", 
        "Diazepam (Acute muscle spasms) 5mg (TABLET)"
    ] 
};

medMap["Advanced Paramedic"] = medMap["Paramedic"].concat(medMap["Advanced Paramedic"]);
medMap["HEMS"] = medMap["Advanced Paramedic"].concat(medMap["HEMS"]);
medMap["Doctor"] = medMap["HEMS"].concat(medMap["Doctor"]);
medMap["Junior Doctor"] = medMap["Doctor"];
medMap["Silver Command"] = medMap["Doctor"];
medMap["Gold Command"] = medMap["Doctor"];

let meds = [], allergies = [], hart = [], rsiLog = [];
let currentMedList = [];
let selectedMedication = "";

// Shared Init Logic
window.addEventListener('DOMContentLoaded', () => {
    loadLocalData();
    updateClock();
    setInterval(updateClock, 1000);
});

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const targetTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', targetTheme);
    localStorage.setItem('epcr_theme', targetTheme);
    updateThemeUI(targetTheme);
}

function updateThemeUI(theme) {
    const label = document.getElementById('themeLabel');
    if (label) label.innerText = theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('mobile-open');
}

function updateClock() {
    const clock = document.getElementById('dashClock');
    if (clock) clock.innerText = new Date().toLocaleTimeString();
}

function saveLocalData() {
    const data = JSON.parse(localStorage.getItem('epcr_saved_data') || '{}');
    data.inputs = data.inputs || {};

    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(el => {
        if (el.id) {
            data.inputs[el.id] = el.type === 'checkbox' ? el.checked : el.value;
        }
    });

    data.meds = meds;
    data.allergies = allergies;
    data.hart = hart;
    data.rsiLog = rsiLog;

    localStorage.setItem('epcr_saved_data', JSON.stringify(data));
    updateProgress();
}

function loadLocalData() {
    const savedTheme = localStorage.getItem('epcr_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeUI(savedTheme);

    const raw = localStorage.getItem('epcr_saved_data');
    if (!raw) return;

    try {
        const parsed = JSON.parse(raw);
        meds = parsed.meds || [];
        allergies = parsed.allergies || [];
        hart = parsed.hart || [];
        rsiLog = parsed.rsiLog || [];

        if (parsed.inputs) {
            Object.keys(parsed.inputs).forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    if (el.type === 'checkbox') el.checked = parsed.inputs[id];
                    else el.value = parsed.inputs[id];
                }
            });
        }

        // Apply visibility triggers
        if (document.getElementById('grade')) {
            handleGradeChange();
        } else {
            applyGradeVisibility(parsed.inputs?.grade || "");
        }

        ['majorIncidentSelect', 'tacticalSelect', 'xraySelect', 'mriSelect', 'hartEquipSelect', 'rsiSelect', 'roleSelect', 'shockSelect'].forEach(id => {
            const el = document.getElementById(id);
            if (el && el.onchange) el.onchange();
        });

        if (document.getElementById('medsToggle')) toggleMedsUI();
        if (document.getElementById('allergiesToggle')) toggleAllergiesUI();

        renderLists();
        updateProgress();
    } catch (e) {
        console.error("Failed to load saved state", e);
    }
}

function handleGradeChange() {
    const g = document.getElementById('grade')?.value || "";
    const hartSub = document.getElementById('hartSubSelect');
    
    const dashGrade = document.getElementById('dashGradeDisplay');
    if (dashGrade) dashGrade.innerText = g || "Unselected";

    if (hartSub) hartSub.style.display = (g === "HART") ? "block" : "none";
    
    applyGradeVisibility(g);
    saveLocalData();
}

function applyGradeVisibility(g) {
    const effectiveGrade = (g === "HART") ? (document.getElementById('hartGrade')?.value || "Paramedic") : g;
    const isHD = (g === "HEMS" || g === "Junior Doctor" || g === "Doctor" || g === "Gold Command" || g === "Silver Command");
    
    document.querySelectorAll('.hems-doc-only').forEach(el => el.style.display = isHD ? "block" : "none");
    document.querySelectorAll('.hart-only').forEach(el => el.style.display = (g === "HART" || g === "Gold Command" || g === "Silver Command") ? "block" : "none");

    currentMedList = medMap[effectiveGrade] ? medMap[effectiveGrade].sort() : [];
    if (document.getElementById('medListContainer')) filterMedList();
}

function filterMedList() {
    const query = document.getElementById('medSearch')?.value.toLowerCase() || "";
    const container = document.getElementById('medListContainer');
    if (!container) return;

    container.innerHTML = "";
    const filtered = currentMedList.filter(m => m.toLowerCase().includes(query));

    if (filtered.length === 0) {
        container.innerHTML = `<div class="no-meds-found">No matching medications found</div>`;
        return;
    }

    filtered.forEach(m => {
        const item = document.createElement('div');
        item.className = `med-option ${selectedMedication === m ? 'selected' : ''}`;
        item.textContent = m;
        item.onclick = function() {
            selectedMedication = m;
            document.querySelectorAll('.med-option').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
        };
        container.appendChild(item);
    });
}

function toggleHiddenDiv(s, d) { 
    const select = document.getElementById(s);
    const target = document.getElementById(d);
    if (select && target) {
        target.style.display = (select.value === "Yes") ? "block" : "none"; 
    }
    updateProgress();
}

function toggleMedsUI() { 
    const toggle = document.getElementById('medsToggle');
    const logger = document.getElementById('medsLoggerUI');
    if (toggle && logger) logger.style.display = toggle.checked ? "block" : "none"; 
    updateProgress();
}

function toggleAllergiesUI() {
    const toggle = document.getElementById('allergiesToggle');
    const logger = document.getElementById('allergiesLoggerUI');
    if (toggle && logger) logger.style.display = toggle.checked ? "block" : "none";
    updateProgress();
}

// Modals
function openMedModal() {
    if (document.getElementById('medSearch')) document.getElementById('medSearch').value = "";
    selectedMedication = "";
    filterMedList();
    document.getElementById('medModal')?.classList.add('active');
}

function closeMedModal() {
    document.getElementById('medModal')?.classList.remove('active');
}

function openAllergyModal() {
    document.getElementById('allergyModal')?.classList.add('active');
}

function closeAllergyModal() {
    document.getElementById('allergyModal')?.classList.remove('active');
}

function checkCustomAllergy() {
    const val = document.getElementById('allergySelect')?.value;
    const group = document.getElementById('customAllergyGroup');
    if (group) group.style.display = (val === 'Other') ? 'flex' : 'none';
}

function logAllergy() {
    const sel = document.getElementById('allergySelect')?.value;
    let entry = sel;
    if (sel === 'Other') {
        const custom = document.getElementById('customAllergyInput')?.value.trim();
        if (!custom) return;
        entry = custom;
    }
    allergies.push(entry);
    renderLists();
    saveLocalData();
    closeAllergyModal();
    if (document.getElementById('customAllergyInput')) document.getElementById('customAllergyInput').value = '';
}

function logMedication() { 
    if(!selectedMedication) {
        alert("Please select a medication from the list.");
        return;
    }
    const time = document.getElementById('medTime')?.value || 'N/A';
    const dose = document.getElementById('medDose')?.value || 'N/A';
    
    meds.push(`[${time}] ${selectedMedication} (${dose})`); 
    renderLists(); 
    saveLocalData();
    closeMedModal();
}

function logHart() { 
    const val = document.getElementById('hartEquipDropdown')?.value;
    if (val) {
        hart.push(val); 
        renderLists(); 
        saveLocalData();
    }
}

function logRsi() { 
    const time = document.getElementById('rsiTimeInput')?.value || 'N/A';
    const med = document.getElementById('rsiMedSelect')?.value || '';
    if (med) {
        rsiLog.push(`[${time}] ${med}`); 
        renderLists(); 
        saveLocalData();
    }
}

function renderLists() {
    const l1 = document.getElementById('loggedMedsList'), 
          l2 = document.getElementById('loggedHartList'), 
          l3 = document.getElementById('loggedRsiList'),
          l4 = document.getElementById('loggedAllergiesList');

    if (l1) { l1.innerHTML = ""; meds.forEach((m, i) => l1.innerHTML += `<li class="logged-item"><span>${m}</span> <span class="delete-btn" onclick="meds.splice(${i},1); renderLists(); saveLocalData();">✖</span></li>`); }
    if (l2) { l2.innerHTML = ""; hart.forEach((h, i) => l2.innerHTML += `<li class="logged-item"><span>${h}</span> <span class="delete-btn" onclick="hart.splice(${i},1); renderLists(); saveLocalData();">✖</span></li>`); }
    if (l3) { l3.innerHTML = ""; rsiLog.forEach((r, i) => l3.innerHTML += `<li class="logged-item"><span>${r}</span> <span class="delete-btn" onclick="rsiLog.splice(${i},1); renderLists(); saveLocalData();">✖</span></li>`); }
    if (l4) { l4.innerHTML = ""; allergies.forEach((a, i) => l4.innerHTML += `<li class="logged-item"><span>${a}</span> <span class="delete-btn" onclick="allergies.splice(${i},1); renderLists(); saveLocalData();">✖</span></li>`); }
}

function resetForm() { 
    if(confirm("Are you sure you want to clear the entire ePCR data?")) { 
        localStorage.removeItem('epcr_saved_data');
        location.reload();
    } 
}

function updateProgress() {
    const data = JSON.parse(localStorage.getItem('epcr_saved_data') || '{}');
    const inputs = data.inputs || {};
    const keys = Object.keys(inputs);
    
    let filled = 0;
    keys.forEach(k => {
        if (inputs[k] === true || (typeof inputs[k] === 'string' && inputs[k].trim() !== '')) {
            filled++;
        }
    });

    const percentage = keys.length > 0 ? Math.round((filled / keys.length) * 100) : 0;
    const bar = document.getElementById('progressBar');
    if (bar) bar.style.width = percentage + '%';
}

// Copy Outputs
function copyInjuryMDT(btn) {
    const data = JSON.parse(localStorage.getItem('epcr_saved_data') || '{}').inputs || {};
    const xray = (data.xraySelect === "Yes") ? (data.xrayResults || "N/A") : "No";
    const mri = (data.mriSelect === "Yes") ? (data.mriResults || "N/A") : "No";
    const grade = data.grade || "Unselected";
    const callsign = data.callsign || "N/A";
    
    let sceneText = "\n\n";
    if (grade.match(/HEMS|Doctor|Gold Command|Silver Command/)) {
        const loc = data.sceneLocation || "N/A";
        const callInfo = data.originalCall || "N/A";
        const sceneCmd = data.sceneCommand || "N/A";
        
        let majorInc = data.majorIncidentSelect || "No";
        if(majorInc === "Yes") majorInc += ` (${data.majorIncidentDesc || "No details provided"})`;
        
        let tactCmd = data.tacticalSelect || "No";
        if(tactCmd === "Yes") tactCmd += ` (${data.tacticalName || "Unknown"})`;
        
        const extra = data.sceneFindings || "None";
        sceneText = `\n\n--- SCENE FINDINGS ---\nLocation: ${loc}\nOriginal Call Info: ${callInfo}\nMajor Incident: ${majorInc}\nClinical Scene Command: ${sceneCmd}\nTactical Commander: ${tactCmd}\nAdditional Findings: ${extra}\n\n`;
    }
    
    const out = `*** ePCR: INJURY REPORT ***\nUNIT: ${callsign} | GRADE: ${grade} | DATE: ${data.date || 'N/A'}${sceneText}PRIMARY COMPLAINT:\n${data.injuryInfo || 'N/A'}\n\n--- IMAGING ---\nX-RAY: ${xray}\nMRI: ${mri}`;
    
    navigator.clipboard.writeText(out).then(() => {
        const originalText = btn.innerHTML;
        btn.innerHTML = "✅ Copy Complete!";
        setTimeout(() => { btn.innerHTML = originalText; }, 2000);
    });
}

function copyTreatmentMDT(btn) {
    const data = JSON.parse(localStorage.getItem('epcr_saved_data') || '{}').inputs || {};
    
    let rsiText = "";
    if (data.rsiSelect === "Yes" && rsiLog.length > 0) {
        rsiText = `\n\n--- RSI ADMINISTERED ---\n${rsiLog.join('\n')}`;
    }

    const hEq = (hart.length > 0) ? `\n\n--- HART EQUIPMENT ---\n${hart.join(', ')}` : "";
    const callsign = data.callsign || "N/A";
    
    let roleText = "";
    if (data.roleSelect === "Yes") {
        roleText = `\n\n--- CRITICAL STATUS ---\nROLE (Recognition of Life Extinct): Confirmed @ ${data.roleTime || "Unknown Time"}`;
        
        if (data.shockSelect === "Yes") {
            roleText += `\nSHOCKS DELIVERED: Yes (${data.shockCount || "0"} times)`;
        } else {
            roleText += `\nSHOCKS DELIVERED: No`;
        }

        if (data.morgueSelect === "Yes") {
            roleText += `\nTAKEN TO MORGUE: Yes @ ${data.morgueTime || "Unknown Time"}`;
        } else {
            roleText += `\nTAKEN TO MORGUE: No`;
        }
    }

    let comaText = "";
    if (data.comaSelect === "Yes") {
        comaText = `\n\nPATIENT PLACED IN COMA: Yes @ ${data.comaTime || "Unknown Time"}`;
    }

    const allergyText = (data.allergiesToggle && allergies.length > 0) ? `\n\n--- ALLERGIES ---\n${allergies.join(', ')}` : "";

    const out = `*** ePCR: TREATMENT REPORT ***\nUNIT: ${callsign} | PROVIDER: ${data.grade || "Unselected"}${allergyText}\n${hEq}\n\n--- MEDICATIONS ---\n${meds.length > 0 ? meds.join('\n') : "None"}${rsiText}${roleText}${comaText}\n\n--- NOTES ---\n${data.treatmentNotes || "No additional notes."}`;
    
    navigator.clipboard.writeText(out).then(() => {
        const originalText = btn.innerHTML;
        btn.innerHTML = "✅ Copy Complete!";
        setTimeout(() => { btn.innerHTML = originalText; }, 2000);
    });
}