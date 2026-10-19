// Konfigurasi Global
let rooms = [];
let currentRoomId = null;
let chatHistory = [];
let isFirstMessage = true;

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['gemini_api_key', 'rooms', 'currentRoomId'], function(result) {
        if (result.gemini_api_key) {
            document.getElementById('apiKey').value = result.gemini_api_key;
        }
        if (result.rooms && result.rooms.length > 0) {
            rooms = result.rooms;
            currentRoomId = result.currentRoomId || rooms[0].id;
            switchRoom(currentRoomId);
        } else {
            initNewRoom(false);
        }
    });

    document.getElementById('settingsToggleBtn').addEventListener('click', () => {
        document.getElementById('roomsPanel').classList.add('hidden'); // Tutup room jika buka setting
        document.getElementById('settingsPanel').classList.toggle('hidden');
    });
    document.getElementById('closeSettingsBtn').addEventListener('click', () => {
        document.getElementById('settingsPanel').classList.add('hidden');
    });
    
    document.getElementById('roomsToggleBtn').addEventListener('click', () => {
        document.getElementById('settingsPanel').classList.add('hidden'); // Tutup setting jika buka room
        openRoomsPanel();
    });
    document.getElementById('closeRoomsBtn').addEventListener('click', () => {
        document.getElementById('roomsPanel').classList.add('hidden');
    });
    
    document.getElementById('createNewRoomBtn').addEventListener('click', () => {
        initNewRoom(true);
        document.getElementById('roomsPanel').classList.add('hidden');
    });
    
    document.getElementById('toggleEyeBtn').addEventListener('click', toggleApiKeyVisibility);
    document.getElementById('generateBtn').addEventListener('click', generateMasterPrompt);

    document.getElementById('userPrompt').addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            generateMasterPrompt();
        }
    });
});

// ================= FUNGSI MANAJEMEN ROOM =================

function initNewRoom(saveToStorage = true) {
    currentRoomId = 'room_' + Date.now();
    chatHistory = [];
    isFirstMessage = true;
    updateRoomTitleUI("Room Baru (Kosong)");
    renderChatHistory();
    if(saveToStorage) saveRoomsToStorage();
}

function switchRoom(roomId) {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
        currentRoomId = room.id;
        chatHistory = room.history || [];
        isFirstMessage = room.isFirstMessage !== undefined ? room.isFirstMessage : true;
        updateRoomTitleUI(room.title);
        renderChatHistory();
        saveRoomsToStorage();
    }
}

function deleteRoom(roomId, event) {
    event.stopPropagation();
    if (confirm("Yakin ingin menghapus riwayat room ini?")) {
        rooms = rooms.filter(r => r.id !== roomId);
        if (currentRoomId === roomId) {
            if (rooms.length > 0) switchRoom(rooms[0].id);
            else initNewRoom(true);
        }
        saveRoomsToStorage();
        renderRoomsListUI();
    }
}

function saveRoomsToStorage() {
    chrome.storage.local.set({ rooms: rooms, currentRoomId: currentRoomId });
}

function updateActiveRoomData(userPromptText) {
    let roomIndex = rooms.findIndex(r => r.id === currentRoomId);
    if (roomIndex === -1) {
        let titleText = userPromptText.substring(0, 25);
        if (userPromptText.length > 25) titleText += "...";
        rooms.unshift({ id: currentRoomId, title: titleText, history: chatHistory, isFirstMessage: isFirstMessage });
        updateRoomTitleUI(titleText);
    } else {
        rooms[roomIndex].history = chatHistory;
        rooms[roomIndex].isFirstMessage = isFirstMessage;
    }
    saveRoomsToStorage();
}

// ================= FUNGSI UI / TAMPILAN =================

function openRoomsPanel() {
    renderRoomsListUI();
    document.getElementById('roomsPanel').classList.remove('hidden');
}

function updateRoomTitleUI(title) {
    document.getElementById('currentRoomTitle').textContent = title;
}

function renderRoomsListUI() {
    const container = document.getElementById('roomsContainer');
    container.innerHTML = ''; 
    
    if (rooms.length === 0) {
        container.innerHTML = `<p class="text-xs text-center mt-6" style="color: var(--text-muted);">Belum ada riwayat room yang tersimpan.</p>`;
        return;
    }

    rooms.forEach(room => {
        const isActive = room.id === currentRoomId;
        const roomEl = document.createElement('div');
        
        // Styling Room Item yang Mewah
        roomEl.className = `flex justify-between items-center p-3.5 rounded-lg border cursor-pointer transition-all duration-200 group `;
        if (isActive) {
            roomEl.style.backgroundColor = "rgba(99, 102, 241, 0.1)";
            roomEl.style.borderColor = "rgba(99, 102, 241, 0.4)";
        } else {
            roomEl.style.backgroundColor = "#0a0a0a";
            roomEl.style.borderColor = "var(--border-soft)";
            roomEl.onmouseover = () => roomEl.style.backgroundColor = "#121212";
            roomEl.onmouseout = () => roomEl.style.backgroundColor = "#0a0a0a";
        }
        
        roomEl.onclick = () => {
            switchRoom(room.id);
            document.getElementById('roomsPanel').classList.add('hidden');
        };

        const leftSide = document.createElement('div');
        leftSide.className = "flex items-center gap-3 overflow-hidden";
        leftSide.innerHTML = `<i class="fa-regular fa-message ${isActive ? 'text-indigo-400' : 'text-gray-500'}"></i>
                              <span class="text-xs truncate max-w-[200px] font-medium ${isActive ? 'text-indigo-200' : 'text-gray-300'}">${room.title}</span>`;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = "w-7 h-7 rounded flex items-center justify-center transition opacity-60 hover:opacity-100 hover:bg-red-500/20 hover:text-red-400";
        deleteBtn.innerHTML = `<i class="fa-solid fa-trash-can text-[10px]"></i>`;
        deleteBtn.onclick = (e) => deleteRoom(room.id, e);

        roomEl.appendChild(leftSide);
        roomEl.appendChild(deleteBtn);
        container.appendChild(roomEl);
    });
}

function toggleApiKeyVisibility() {
    const input = document.getElementById('apiKey');
    const icon = document.getElementById('eyeIcon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-solid fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fa-solid fa-eye';
    }
}

function scrollToBottom() {
    const chatBox = document.getElementById('chatBox');
    chatBox.scrollTop = chatBox.scrollHeight;
}

function renderChatHistory() {
    const chatBox = document.getElementById('chatBox');
    chatBox.innerHTML = ''; 
    
    if (chatHistory.length === 0) {
        chatBox.innerHTML = `
            <div id="emptyState" class="text-center text-xs my-auto flex flex-col items-center justify-center" style="color: var(--text-muted);">
                <div class="w-12 h-12 rounded-full mb-3 flex items-center justify-center" style="background: rgba(99, 102, 241, 0.1);">
                    <i class="fa-solid fa-wand-magic-sparkles text-xl text-indigo-400"></i>
                </div>
                <p>Room Kosong.<br>Ketik ide Anda untuk memulai penyusunan Prompt.</p>
            </div>`;
        return;
    }

    chatHistory.forEach((msg, index) => {
        if (msg.role === 'user') appendUserBubble(msg.parts[0].text);
        else appendAIBubble(msg.parts[0].text, `history-${index}`);
    });
    scrollToBottom();
}

function appendUserBubble(text) {
    const chatBox = document.getElementById('chatBox');
    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.remove();

    const bubble = document.createElement('div');
    bubble.className = "self-end px-3.5 py-2.5 rounded-xl rounded-tr-sm max-w-[85%] text-xs shadow-md";
    bubble.style.background = "var(--accent-gradient)";
    bubble.style.color = "#ffffff";
    bubble.textContent = text;
    chatBox.appendChild(bubble);
    scrollToBottom();
}

function appendAIBubble(text, id) {
    const chatBox = document.getElementById('chatBox');
    
    const container = document.createElement('div');
    container.className = "self-start rounded-xl rounded-tl-sm max-w-[95%] w-full shadow-lg flex flex-col overflow-hidden";
    container.style.backgroundColor = "var(--bg-bubble-ai)";
    container.style.border = "1px solid var(--border-soft)";
    
    const header = document.createElement('div');
    header.className = "flex justify-between items-center px-3 py-2 border-b";
    header.style.borderColor = "var(--border-soft)";
    header.style.backgroundColor = "rgba(0,0,0,0.2)";
    header.innerHTML = `
        <span class="text-[10px] font-semibold flex items-center gap-1.5" style="color: #4ade80;"><i class="fa-solid fa-robot"></i> AI Master Prompt</span>
        <button id="copy-${id}" class="text-[10px] px-2 py-1 rounded transition hover:bg-white/10" style="border: 1px solid var(--border-soft); color: var(--text-main);">
            <i class="fa-regular fa-copy"></i> Salin
        </button>
    `;

    const contentDiv = document.createElement('div');
    contentDiv.className = "p-3.5 overflow-x-auto";
    const pre = document.createElement('pre');
    pre.className = "text-[11px] leading-relaxed";
    pre.style.color = "#d4d4d8";
    pre.textContent = text;
    
    contentDiv.appendChild(pre);
    container.appendChild(header);
    container.appendChild(contentDiv);
    chatBox.appendChild(container);

    header.querySelector(`#copy-${id}`).addEventListener('click', function() {
        navigator.clipboard.writeText(text).then(() => {
            this.innerHTML = `<i class="fa-solid fa-check text-green-400"></i> Disalin`;
            this.style.borderColor = "#4ade80";
            setTimeout(() => {
                this.innerHTML = `<i class="fa-regular fa-copy"></i> Salin`;
                this.style.borderColor = "var(--border-soft)";
            }, 2000);
        });
    });
    scrollToBottom();
}

// ================= LOGIKA KOMUNIKASI API =================

async function generateMasterPrompt() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const model = document.getElementById('geminiModel').value;
    const effort = document.getElementById('effortLevel').value;
    const promptInput = document.getElementById('userPrompt');
    const userText = promptInput.value.trim();

    if (!apiKey) {
        alert('Silakan masukkan Gemini API Key pada menu konfigurasi!');
        document.getElementById('settingsPanel').classList.remove('hidden');
        document.getElementById('apiKey').focus();
        return;
    }

    if (!userText) return;
    chrome.storage.local.set({ 'gemini_api_key': apiKey });

    const btn = document.getElementById('generateBtn');
    const btnIcon = document.getElementById('btnIcon');
    const btnText = document.getElementById('btnText');
    
    btn.disabled = true;
    btn.style.opacity = "0.7";
    btnIcon.className = "fa-solid fa-circle-notch fa-spin";
    btnText.textContent = "Menyusun...";
    promptInput.value = ""; 
    appendUserBubble(userText); 

    let systemInstruction = "";
    if (isFirstMessage) {
        systemInstruction = `Anda adalah Master Prompt Engineer tingkat lanjut.
Ubah ide pengguna menjadi Master Prompt yang komprehensif.
Anda HARUS menghasilkan struktur persis berikut ini beserta isinya:
1. **[Role]**: Peran/keahlian AI.
2. **[Task]**: Tugas utama yang dieksekusi.
3. **[Context]**: Latar belakang.
4. **[Reasoning]**: Instruksi chain-of-thought.
5. **[Stop]**: Batasan ketat.
6. **[Output]**: Format hasil akhir.
Jangan berikan basa-basi.`;
    } else {
        systemInstruction = `Anda adalah Master Prompt Engineer. Ini adalah lanjutan sesi. Evaluasi dan revisi prompt sebelumnya berdasarkan instruksi terbaru pengguna.
Anda HANYA boleh menghasilkan struktur berikut ini:
1. **[Task]**: Tugas utama yang disesuaikan.
2. **[Context]**: Konteks baru yang disesuaikan.
3. **[Output]**: Format hasil akhir yang disesuaikan.
DILARANG menampilkan [Role], [Reasoning], atau [Stop]. Jangan berikan basa-basi.`;
    }

    const requestBody = {
        contents: [...chatHistory, { role: "user", parts: [{ text: userText }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.7, thinkingConfig: { thinkingLevel: effort } }
    };

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'Gagal menghubungi API Gemini.');

        const candidate = data.candidates?.[0];
        if (candidate && candidate.content?.parts?.[0]?.text) {
            const aiText = candidate.content.parts[0].text;
            chatHistory.push({ role: "user", parts: [{ text: userText }] });
            chatHistory.push({ role: "model", parts: [{ text: aiText }] });
            isFirstMessage = false;
            updateActiveRoomData(userText);
            appendAIBubble(aiText, Date.now().toString());
        } else throw new Error('Format respons API tidak valid.');
    } catch (error) {
        appendAIBubble(`[ERROR]: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.style.opacity = "1";
        btnIcon.className = "fa-solid fa-paper-plane";
        btnText.textContent = "Kirim";
        promptInput.focus();
    }
}