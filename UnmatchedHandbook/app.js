// Fetch JSON data dynamically and initialize the app
async function initHandbook() {
    try {
        const response = await fetch('data.json');
        const HANDBOOK_DATA = await response.json();
        renderHandbook(HANDBOOK_DATA);
    } catch (error) {
        console.error('Error loading data.json:', error);
    }
}

// Render dynamic elements
function renderHandbook(HANDBOOK_DATA) {
    const navContainer = document.getElementById('sidebarNav');
    const mainContainer = document.getElementById('appContainer');

    navContainer.innerHTML = '';
    mainContainer.innerHTML = '';

    HANDBOOK_DATA.tabs.forEach((tab, index) => {
        // Build Sidebar Navigation Buttons
        const navBtn = document.createElement('button');
        navBtn.className = `nav-btn ${index === 0 ? 'active' : ''}`;
        navBtn.setAttribute('onclick', `openTab('${tab.id}', this)`);
        navBtn.innerHTML = `<span class="icon">${tab.icon}</span> ${tab.name}`;
        navContainer.appendChild(navBtn);

        // Build Tab Container
        const tabDiv = document.createElement('div');
        tabDiv.id = tab.id;
        tabDiv.className = `tab-content ${index === 0 ? 'active' : ''}`;

        // Populate Tab Elements
        const tabData = HANDBOOK_DATA.content[tab.id] || [];
        tabData.forEach(item => {
            if (item.type === "h2") {
                const h2 = document.createElement('h2');
                h2.textContent = item.text;
                tabDiv.appendChild(h2);
            } 
            else if (item.type === "alert") {
                const alert = document.createElement('div');
                alert.className = 'alert';
                alert.innerHTML = item.text;
                tabDiv.appendChild(alert);
            }
            else if (item.type === "search") {
                const searchDiv = document.createElement('div');
                searchDiv.className = 'search-container';
                searchDiv.innerHTML = `<input type="text" id="medSearch" onkeyup="searchMeds()" placeholder="🔍 Search medication or symptom...">`;
                tabDiv.appendChild(searchDiv);
            }
            else if (item.type === "accordion") {
                const btn = document.createElement('button');
                btn.className = `accordion ${item.isMed ? 'med-accordion' : ''}`;
                btn.textContent = item.title;

                const panel = document.createElement('div');
                panel.className = 'panel';

                const inner = document.createElement('div');
                inner.className = 'panel-inner';

                if (item.alert) inner.innerHTML += `<div class="alert">${item.alert}</div>`;
                if (item.paragraphs) item.paragraphs.forEach(p => inner.innerHTML += `<p>${p}</p>`);

                if (item.list) {
                    let ul = '<ul>';
                    item.list.forEach(li => ul += `<li>${li}</li>`);
                    ul += '</ul>';
                    inner.innerHTML += ul;
                }

                if (item.orderedList) {
                    let ol = '<ol>';
                    item.orderedList.forEach(li => ol += `<li>${li}</li>`);
                    ol += '</ol>';
                    inner.innerHTML += ol;
                }

                if (item.subsections) {
                    item.subsections.forEach(sub => {
                        if (sub.h3) inner.innerHTML += `<h3>${sub.h3}</h3>`;
                        if (sub.paragraphs) sub.paragraphs.forEach(p => inner.innerHTML += `<p>${p}</p>`);
                        if (sub.list) {
                            let ul = '<ul>';
                            sub.list.forEach(li => ul += `<li>${li}</li>`);
                            ul += '</ul>';
                            inner.innerHTML += ul;
                        }
                    });
                }

                if (item.table) {
                    let tbl = `<div class="table-responsive"><table class="${item.isMed ? 'medTable' : ''}">`;
                    tbl += `<tr class="grade-header">`;
                    item.table.headers.forEach(h => tbl += `<th>${h}</th>`);
                    tbl += `</tr>`;
                    item.table.rows.forEach(r => {
                        tbl += `<tr>`;
                        r.forEach(c => tbl += `<td>${c}</td>`);
                        tbl += `</tr>`;
                    });
                    tbl += `</table></div>`;
                    inner.innerHTML += tbl;
                }

                if (item.code) inner.innerHTML += `<code>${item.code}</code>`;

                if (item.download) {
                    inner.innerHTML += `
                        <a href="${item.download.link}" download class="download-btn">
                            <span style="font-size: 1.2rem;">💾</span> ${item.download.label}
                        </a>`;
                }

                panel.appendChild(inner);
                tabDiv.appendChild(btn);
                tabDiv.appendChild(panel);
            }
        });

        mainContainer.appendChild(tabDiv);
    });

    bindAccordions();
}

// Theme Toggle Logic
function toggleTheme() {
    const body = document.documentElement;
    const btn = document.getElementById('themeToggle');
    if (body.getAttribute('data-theme') === 'dark') {
        body.removeAttribute('data-theme');
        btn.textContent = '🌙';
        localStorage.setItem('theme', 'light');
    } else {
        body.setAttribute('data-theme', 'dark');
        btn.textContent = '☀️';
        localStorage.setItem('theme', 'dark');
    }
}

// Apply saved theme preference on load
(function() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.getElementById('themeToggle').textContent = '☀️';
    }
})();

// Toggle Side Navigation Menu
function toggleMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
}

// Tab switching logic
function openTab(tabName, element) {
    let i, tabcontent, navbtns;
    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].classList.remove("active");
    }
    
    navbtns = document.getElementsByClassName("nav-btn");
    for (i = 0; i < navbtns.length; i++) {
        navbtns[i].classList.remove("active");
    }
    
    document.getElementById(tabName).classList.add("active");
    element.classList.add("active");
    
    toggleMenu();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Accordion Event Listener Setup
function bindAccordions() {
    let acc = document.getElementsByClassName("accordion");
    for (let i = 0; i < acc.length; i++) {
        acc[i].addEventListener("click", function() {
            this.classList.toggle("active-acc");
            let panel = this.nextElementSibling;
            if (panel.style.maxHeight) {
                panel.style.maxHeight = null;
            } else {
                panel.style.maxHeight = panel.scrollHeight + "px";
            } 
        });
    }
}

// Global Medication Search filter
function searchMeds() {
    let input = document.getElementById("medSearch").value.toUpperCase();
    let tables = document.querySelectorAll(".medTable");

    tables.forEach(table => {
        let tr = table.getElementsByTagName("tr");
        let hasVisibleRow = false;
        
        for (let i = 1; i < tr.length; i++) {
            tr[i].style.display = "none"; 
            let td = tr[i].getElementsByTagName("td");
            for (let j = 0; j < td.length; j++) {
                if (td[j]) {
                    let txtValue = td[j].textContent || td[j].innerText;
                    if (txtValue.toUpperCase().indexOf(input) > -1) {
                        tr[i].style.display = ""; 
                        hasVisibleRow = true;
                        break; 
                    }
                }
            }
        }

        let panel = table.closest('.panel');
        let accordionBtn = panel.previousElementSibling;
        
        if (input !== "") {
            if (hasVisibleRow) {
                panel.style.maxHeight = panel.scrollHeight + 50 + "px";
                accordionBtn.classList.add("active-acc");
            } else {
                panel.style.maxHeight = null;
                accordionBtn.classList.remove("active-acc");
            }
        }
    });
}

// Run on page load
window.addEventListener('DOMContentLoaded', initHandbook);