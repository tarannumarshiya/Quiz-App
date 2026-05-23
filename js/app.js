import { isFirebaseConfigured, saveFirebaseConfig, clearFirebaseConfig, initializeFirebaseApp } from './firebase-init.js';
import { authService } from './auth.js';
import { dbService } from './database.js';
import { renderAnalyticsCharts, destroyCharts } from './charts.js';
import { audio } from './audio.js';

// Secure HTML escaping helper for imported questions
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Application State Variables
let currentUser = null;
let activeQuiz = null;
let currentQuestionIndex = 0;
let userSelectedOption = null; // Stores currently selected option index during gameplay
let userSelections = []; // Stores user selected choices (indices or null) chronologically
let quizQuestions = [];
let quizTimer = null;
let questionTimeLimit = 30; // default
let quizTimeLeft = 30;
let quizScore = 0;
let unsubscribeLeaderboard = null;
let currentLeaderboardScope = 'quiz'; // 'quiz' or 'global'
let activeQuizIdForLeaderboard = '';
let currentLeaderboardEntries = [];

// Screen elements mapping
const screens = {
  config: document.getElementById('config-view'),
  auth: document.getElementById('auth-view'),
  dashboard: document.getElementById('dashboard-view'),
  createQuiz: document.getElementById('create-quiz-view'),
  quizPlay: document.getElementById('quiz-play-view'),
  results: document.getElementById('results-view'),
  leaderboard: document.getElementById('leaderboard-view'),
  profile: document.getElementById('profile-view')
};

// Global Bootstrapper
document.addEventListener('DOMContentLoaded', () => {
  setupAppRouting();
  setupAudioControl();
  setupConfigWizard();
  setupAuthHandlers();
  setupDashboardControls();
  setupCreateQuizStudio();
  setupGameplayActions();
  setupLeaderboardToggles();
  setupResetConfigButton();
  
  // Initialize App state based on database configuration status
  bootstrapAppState();
});

// Determine active view based on config & auth state
function bootstrapAppState() {
  if (!isFirebaseConfigured()) {
    switchView('config');
  } else {
    // Initialize services
    authService.init();
    dbService.init();
    
    // Subscribe to auth state changes
    authService.onAuthStateChanged(async (user) => {
      if (user) {
        currentUser = user;
        updateUserNavHeader(user);
        await syncUserDashboardStats();
        
        // If we were on config or auth, direct to dashboard
        if (isCurrentView('config') || isCurrentView('auth')) {
          switchView('dashboard');
        }
      } else {
        currentUser = null;
        updateUserNavHeader(null);
        switchView('auth');
      }
    });
  }
}

// -------------------------------------------------------------
// Core SPA Routing & View Management
// -------------------------------------------------------------
function switchView(targetKey, isSearchNav = false) {
  if (unsubscribeLeaderboard) {
    unsubscribeLeaderboard();
    unsubscribeLeaderboard = null;
  }

  // Clear running timers
  if (quizTimer) {
    clearInterval(quizTimer);
    quizTimer = null;
  }

  // Hide all screens
  Object.keys(screens).forEach(key => {
    if (screens[key]) screens[key].classList.add('hidden');
  });

  // Show active screen
  if (screens[targetKey]) {
    screens[targetKey].classList.remove('hidden');
  }

  // Handle active navigation classes
  updateActiveNavTab(isSearchNav ? 'search' : targetKey);

  // Trigger special view lifecycles
  if (targetKey === 'profile') {
    loadProfileView();
  } else if (targetKey === 'leaderboard') {
    loadLeaderboardView();
  } else if (targetKey === 'dashboard') {
    syncUserDashboardStats();
  }
}

function isCurrentView(key) {
  return screens[key] && !screens[key].classList.contains('hidden');
}

function setupAppRouting() {
  const binds = [
    { el: document.getElementById('brand-logo'), target: 'dashboard' },
    { el: document.getElementById('nav-dashboard'), target: 'dashboard' },
    { el: document.getElementById('nav-search'), target: 'leaderboard', focusSearch: true },
    { el: document.getElementById('nav-create'), target: 'createQuiz' },
    { el: document.getElementById('nav-leaderboard'), target: 'leaderboard' },
    { el: document.getElementById('nav-profile'), target: 'profile' }
  ];

  binds.forEach(bind => {
    if (bind.el) {
      bind.el.addEventListener('click', (e) => {
        e.preventDefault();
        audio.playClick();
        if (!currentUser) {
          switchView('auth');
        } else {
          switchView(bind.target, bind.focusSearch);
          if (bind.focusSearch) {
            // Focus on the player name input and add a visual border glow/highlight outline
            const searchInput = document.getElementById('lead-player-name-input');
            if (searchInput) {
              setTimeout(() => {
                searchInput.focus();
                searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Highlight outline style
                searchInput.classList.add('ring-2', 'ring-neonPink', 'shadow-neon-pink');
                setTimeout(() => {
                  searchInput.classList.remove('ring-2', 'ring-neonPink', 'shadow-neon-pink');
                }, 2000);
              }, 150);
            }
          }
        }
      });
    }
  });
}

function updateActiveNavTab(activeKey) {
  const tabs = {
    dashboard: document.getElementById('nav-dashboard'),
    search: document.getElementById('nav-search'),
    createQuiz: document.getElementById('nav-create'),
    leaderboard: document.getElementById('nav-leaderboard'),
    profile: document.getElementById('nav-profile')
  };

  Object.keys(tabs).forEach(key => {
    const tab = tabs[key];
    if (!tab) return;
    
    if (key === activeKey) {
      tab.className = "px-4 py-2 rounded-lg text-sm font-semibold text-neonCyan bg-white/5 border border-neonCyan/20 text-glow-cyan shadow-neon-cyan/10 transition-all duration-200";
    } else {
      tab.className = "px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 transition-all duration-200";
    }
  });
}

// -------------------------------------------------------------
// Firebase Configuration Setup Wizard
// -------------------------------------------------------------
function setupConfigWizard() {
  const form = document.getElementById('config-form');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    audio.playClick();
    const rawJson = document.getElementById('config-json-input').value.trim();
    
    if (!rawJson) {
      showToast("Please enter a valid configuration payload.", false);
      return;
    }

    try {
      // Clean JSON string or JavaScript object notation
      let cleanedJson = rawJson;
      // If user pasted "const firebaseConfig = { ... };" strip JavaScript declaration details
      if (rawJson.includes('{')) {
        const startIdx = rawJson.indexOf('{');
        const endIdx = rawJson.lastIndexOf('}');
        cleanedJson = rawJson.substring(startIdx, endIdx + 1);
      }

      // Convert JavaScript-style keys to valid JSON format by using an evaluation trick (safely scoped)
      // or parsing simple JSON. Safest way is wrapping in functional evaluation to extract objects:
      const parsedConfig = new Function(`return ${cleanedJson}`)();
      
      if (!parsedConfig || !parsedConfig.apiKey || !parsedConfig.databaseURL) {
        showToast("Firebase Config is missing 'apiKey' or 'databaseURL'. Check your keys.", false);
        return;
      }

      saveFirebaseConfig(parsedConfig);
      showToast("Firebase Hub Successfully Connected!", true);
      
      // Bootstrap the app
      bootstrapAppState();
    } catch (err) {
      console.error(err);
      showToast("Could not parse config. Please check format structure.", false);
    }
  });
}

function setupResetConfigButton() {
  const handleReset = () => {
    audio.playClick();
    if (confirm("Are you sure you want to disconnect Firebase Database? You will need to re-enter your config.")) {
      clearFirebaseConfig();
      showToast("Configuration Cleared.", true);
      window.location.reload();
    }
  };

  const btn = document.getElementById('btn-reset-firebase');
  if (btn) {
    btn.addEventListener('click', handleReset);
  }

  const profBtn = document.getElementById('btn-prof-reset-config');
  if (profBtn) {
    profBtn.addEventListener('click', handleReset);
  }
}

// -------------------------------------------------------------
// Authentication Section (Login / Sign Up)
// -------------------------------------------------------------
function setupAuthHandlers() {
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const formLogin = document.getElementById('login-form');
  const formRegister = document.getElementById('register-form');

  if (tabLogin && tabRegister && formLogin && formRegister) {
    tabLogin.addEventListener('click', () => {
      audio.playClick();
      tabLogin.className = "flex-1 pb-4 text-center font-display font-semibold text-lg text-white border-b-2 border-neonCyan text-glow-cyan transition-all duration-300";
      tabRegister.className = "flex-1 pb-4 text-center font-display font-semibold text-lg text-gray-400 border-b-2 border-transparent hover:text-white transition-all duration-300";
      formLogin.classList.remove('hidden');
      formRegister.classList.add('hidden');
    });

    tabRegister.addEventListener('click', () => {
      audio.playClick();
      tabRegister.className = "flex-1 pb-4 text-center font-display font-semibold text-lg text-white border-b-2 border-neonPink text-glow-pink transition-all duration-300";
      tabLogin.className = "flex-1 pb-4 text-center font-display font-semibold text-lg text-gray-400 border-b-2 border-transparent hover:text-white transition-all duration-300";
      formRegister.classList.remove('hidden');
      formLogin.classList.add('hidden');
    });
  }

  // Handle Login submission
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      audio.playClick();
      const email = document.getElementById('login-email').value.trim();
      const pass = document.getElementById('login-password').value.trim();
      
      const submitBtn = formLogin.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Accessing Hub...`;

      try {
        await authService.login(email, pass);
        showToast("Console Access Granted. Welcome!", true);
      } catch (err) {
        showToast(err.message, false);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Access Console</span><i class="fa-solid fa-arrow-right"></i>`;
      }
    });
  }

  // Handle Registration submission
  if (formRegister) {
    formRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      audio.playClick();
      const username = document.getElementById('register-username').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const pass = document.getElementById('register-password').value.trim();

      const submitBtn = formRegister.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Deploying Profile...`;

      try {
        await authService.register(email, pass, username);
        showToast("Profile Created Successfully!", true);
      } catch (err) {
        showToast(err.message, false);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Deploy Profile</span><i class="fa-solid fa-user-plus"></i>`;
      }
    });
  }

  // Handle Google Auth submission
  const btnGoogleAuth = document.getElementById('btn-google-auth');
  if (btnGoogleAuth) {
    btnGoogleAuth.addEventListener('click', async () => {
      audio.playClick();
      btnGoogleAuth.disabled = true;
      const originalContent = btnGoogleAuth.innerHTML;
      btnGoogleAuth.innerHTML = `<i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Accessing Credentials...`;

      try {
        const user = await authService.loginWithGoogle();
        showToast(`Welcome, ${user.displayName || "Google Player"}!`, true);
      } catch (err) {
        showToast(err.message, false);
      } finally {
        btnGoogleAuth.disabled = false;
        btnGoogleAuth.innerHTML = originalContent;
      }
    });
  }
}

function updateUserNavHeader(user) {
  const container = document.getElementById('user-nav-status');
  if (!container) return;

  if (user) {
    container.innerHTML = `
      <div class="flex items-center space-x-3">
        <div class="hidden sm:flex flex-col text-right">
          <span class="text-sm font-bold text-white tracking-wide">${user.displayName || 'Explorer'}</span>
          <span class="text-[10px] text-gray-500 font-semibold uppercase">Active Profile</span>
        </div>
        <button id="btn-logout" class="w-10 h-10 rounded-lg flex items-center justify-center bg-rose-950/20 border border-rose-900/30 text-rose-400 hover:text-white hover:bg-rose-950/40 transition-all duration-200" title="Sign Out">
          <i class="fa-solid fa-sign-out-alt"></i>
        </button>
      </div>
    `;
    
    // Bind logout button
    document.getElementById('btn-logout').addEventListener('click', () => {
      audio.playClick();
      authService.logout();
      showToast("Logged out of console.", true);
    });
  } else {
    container.innerHTML = `
      <button id="btn-nav-login" class="px-4 py-2 border border-glassBorder rounded-xl text-xs font-semibold text-gray-300 hover:text-white hover:border-neonCyan transition-all duration-200">
        <i class="fa-solid fa-lock mr-2"></i>Console Lock
      </button>
    `;
  }
}

// -------------------------------------------------------------
// Dashboard Operations & Stats Synchronization
// -------------------------------------------------------------
async function syncUserDashboardStats() {
  if (!currentUser) return;
  
  const welcomeText = document.getElementById('dash-username');
  if (welcomeText) welcomeText.textContent = currentUser.displayName || 'Explorer';

  try {
    const profile = await authService.getUserProfile(currentUser.uid);
    if (profile) {
      document.getElementById('dash-quizzes-count').textContent = profile.totalQuizzesTaken || 0;
      document.getElementById('dash-total-score').textContent = profile.totalScore || 0;
    }
    
    // Render the global champions sneak peek list
    const globalChamps = await dbService.getGlobalLeaderboard();
    const champsList = document.getElementById('global-champs-list');
    if (champsList) {
      if (globalChamps.length === 0) {
        champsList.innerHTML = `<p class="text-xs text-gray-500 text-center py-4">No global champions logged yet.</p>`;
      } else {
        champsList.innerHTML = globalChamps.slice(0, 3).map((u, index) => {
          let rankIcon = `<span class="text-gray-500 font-bold text-sm w-5 text-center">${index + 1}</span>`;
          let rankColor = "text-gray-300";
          if (index === 0) {
            rankIcon = `<i class="fa-solid fa-crown text-neonYellow"></i>`;
            rankColor = "text-neonYellow";
          } else if (index === 1) {
            rankIcon = `<i class="fa-solid fa-medal text-slate-400"></i>`;
            rankColor = "text-slate-300";
          } else if (index === 2) {
            rankIcon = `<i class="fa-solid fa-medal text-orange-500"></i>`;
            rankColor = "text-orange-400";
          }

          return `
            <div class="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-glassBorder">
              <div class="flex items-center space-x-3 truncate">
                ${rankIcon}
                <span class="text-xs font-bold ${rankColor} truncate">${u.username}</span>
              </div>
              <div class="text-right">
                <span class="text-xs font-extrabold text-white">${u.totalScore} pts</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  } catch (e) {
    console.error("Dashboard stats sync failed:", e);
  }
}

function setupDashboardControls() {
  const btnGotoCreate = document.getElementById('btn-goto-create');
  if (btnGotoCreate) {
    btnGotoCreate.addEventListener('click', () => {
      audio.playClick();
      switchView('createQuiz');
    });
  }

  const btnJoinRoom = document.getElementById('btn-join-room');
  if (btnJoinRoom) {
    btnJoinRoom.addEventListener('click', async () => {
      audio.playClick();
      const codeInput = document.getElementById('join-room-code');
      const code = codeInput.value.trim().toUpperCase();
      
      if (!code) {
        showToast("Please enter a valid Quiz Room Code.", false);
        return;
      }

      btnJoinRoom.disabled = true;
      btnJoinRoom.innerHTML = `<i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Accessing Arena...`;

      try {
        const quiz = await dbService.getQuiz(code);
        showToast(`Ready! Accessing: "${quiz.title}"`, true);
        
        // Launch quiz gameplay state
        launchQuizArena(quiz);
      } catch (err) {
        showToast(err.message, false);
      } finally {
        btnJoinRoom.disabled = false;
        btnJoinRoom.innerHTML = `<span>Enter Quiz Arena</span><i class="fa-solid fa-play"></i>`;
      }
    });
  }
}

// -------------------------------------------------------------
// Quiz Creator Studio Wizard
// -------------------------------------------------------------
function setupCreateQuizStudio() {
  const form = document.getElementById('create-quiz-form');
  const btnAdd = document.getElementById('btn-add-question');
  const listContainer = document.getElementById('questions-list');
  const countBadge = document.getElementById('question-count-badge');
  const btnCancel = document.getElementById('btn-cancel-create');

  if (btnCancel) {
    btnCancel.addEventListener('click', (e) => {
      e.preventDefault();
      audio.playClick();
      switchView('dashboard');
    });
  }

  if (btnAdd && listContainer) {
    btnAdd.addEventListener('click', () => {
      audio.playClick();
      const currentCount = listContainer.children.length;
      
      const newQuestionHTML = `
        <div class="question-panel bg-white/5 border border-glassBorder rounded-2xl p-6 relative reveal-anim">
          <div class="absolute -top-3 left-6 px-3 py-1 bg-neonPurple rounded-full text-[10px] font-bold tracking-wider uppercase">Question #${currentCount + 1}</div>
          
          <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mt-2">
            <div class="md:col-span-3 space-y-4">
              <div>
                <label class="block text-xs font-semibold text-gray-400 uppercase mb-2">Question Text</label>
                <input type="text" placeholder="e.g. Which keyword is used to declare block-scoped variables in JS?" required class="w-full bg-gray-950/40 border border-gray-800 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-neonCyan transition-all q-text-input">
              </div>
              
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Option A</label>
                  <input type="text" placeholder="Option A" required class="w-full bg-gray-950/40 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-neonCyan transition-all q-opt-input" data-index="0">
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Option B</label>
                  <input type="text" placeholder="Option B" required class="w-full bg-gray-950/40 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-neonCyan transition-all q-opt-input" data-index="1">
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Option C</label>
                  <input type="text" placeholder="Option C" required class="w-full bg-gray-950/40 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-neonCyan transition-all q-opt-input" data-index="2">
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Option D</label>
                  <input type="text" placeholder="Option D" required class="w-full bg-gray-950/40 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-neonCyan transition-all q-opt-input" data-index="3">
                </div>
              </div>
            </div>

            <div class="flex flex-col justify-between">
              <div>
                <label class="block text-xs font-semibold text-gray-400 uppercase mb-2">Correct Option</label>
                <select class="w-full bg-gray-950/40 border border-gray-800 rounded-lg px-3 py-2.5 text-xs focus:outline-none focus:border-neonCyan transition-all q-correct-select">
                  <option value="0">Option A</option>
                  <option value="1">Option B</option>
                  <option value="2">Option C</option>
                  <option value="3">Option D</option>
                </select>
              </div>
              
              <button type="button" class="w-full mt-4 py-2 border border-rose-500/30 text-rose-400 bg-rose-950/10 hover:bg-rose-950/30 rounded-xl text-xs font-medium transition-all duration-200 btn-delete-question">
                <i class="fa-solid fa-trash-can mr-2"></i>Delete Question
              </button>
            </div>
          </div>
        </div>
      `;

      const wrapper = document.createElement('div');
      wrapper.innerHTML = newQuestionHTML;
      const element = wrapper.firstElementChild;
      listContainer.appendChild(element);

      // Re-enable and bind all delete buttons
      updateQuestionPanelStates();
    });
  }

  // Handle panel click events delegating to delete button actions
  if (listContainer) {
    listContainer.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.btn-delete-question');
      if (deleteBtn && !deleteBtn.disabled) {
        audio.playClick();
        const panel = deleteBtn.closest('.question-panel');
        panel.remove();
        updateQuestionPanelStates();
      }
    });
  }

  function updateQuestionPanelStates() {
    const panels = listContainer.querySelectorAll('.question-panel');
    const total = panels.length;
    countBadge.textContent = total;

    panels.forEach((panel, idx) => {
      // Re-index titles
      const badge = panel.querySelector('.absolute');
      badge.textContent = `Question #${idx + 1}`;

      // Manage single deletion prevention
      const delBtn = panel.querySelector('.btn-delete-question');
      if (total === 1) {
        delBtn.disabled = true;
        delBtn.classList.add('opacity-30', 'cursor-not-allowed');
      } else {
        delBtn.disabled = false;
        delBtn.classList.remove('opacity-30', 'cursor-not-allowed');
      }
    });
  }

  // Handle Import & Export of questions
  const btnImport = document.getElementById('btn-import-questions');
  const btnExport = document.getElementById('btn-export-questions');
  const importFileInput = document.getElementById('import-questions-file');

  if (btnExport) {
    btnExport.addEventListener('click', (e) => {
      e.preventDefault();
      audio.playClick();
      
      const questions = [];
      const panels = listContainer.querySelectorAll('.question-panel');
      
      panels.forEach((panel) => {
        const textVal = panel.querySelector('.q-text-input').value.trim();
        const optionsInputs = panel.querySelectorAll('.q-opt-input');
        const correctVal = parseInt(panel.querySelector('.q-correct-select').value);

        const options = [];
        optionsInputs.forEach(input => {
          options.push(input.value.trim());
        });

        questions.push({
          questionText: textVal,
          options: options,
          correctOption: correctVal
        });
      });

      if (questions.length === 0) {
        showToast("No questions found to export.", false);
        return;
      }

      try {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(questions, null, 2));
        const downloadAnchor = document.createElement("a");
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `battlequiz-questions.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast(`Exported ${questions.length} questions successfully!`, true);
      } catch (err) {
        showToast("Failed to export questions.", false);
      }
    });
  }

  if (btnImport && importFileInput) {
    btnImport.addEventListener('click', (e) => {
      e.preventDefault();
      audio.playClick();
      importFileInput.click();
    });

    importFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function(evt) {
        try {
          const importedQuestions = JSON.parse(evt.target.result);
          
          if (!Array.isArray(importedQuestions)) {
            throw new Error("Invalid format: questions must be a JSON array.");
          }

          // Validate structure
          const isValid = importedQuestions.every(q => {
            return q && 
                   typeof q.questionText === 'string' && 
                   Array.isArray(q.options) && 
                   q.options.length === 4 && 
                   typeof q.correctOption === 'number' && 
                   q.correctOption >= 0 && 
                   q.correctOption <= 3;
          });

          if (!isValid) {
            throw new Error("Invalid structure: questions must have questionText, 4 options, and a correctOption index (0-3).");
          }

          // Clear current questions
          listContainer.innerHTML = '';

          // Render imported questions
          importedQuestions.forEach((q, idx) => {
            const newQuestionHTML = `
              <div class="question-panel bg-white/5 border border-glassBorder rounded-2xl p-6 relative reveal-anim">
                <div class="absolute -top-3 left-6 px-3 py-1 bg-neonPurple rounded-full text-[10px] font-bold tracking-wider uppercase">Question #${idx + 1}</div>
                
                <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mt-2">
                  <div class="md:col-span-3 space-y-4">
                    <div>
                      <label class="block text-xs font-semibold text-gray-400 uppercase mb-2">Question Text</label>
                      <input type="text" placeholder="e.g. Which keyword is used to declare block-scoped variables in JS?" required class="w-full bg-gray-950/40 border border-gray-800 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-neonCyan transition-all q-text-input" value="${escapeHtml(q.questionText)}">
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Option A</label>
                        <input type="text" placeholder="Option A" required class="w-full bg-gray-950/40 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-neonCyan transition-all q-opt-input" data-index="0" value="${escapeHtml(q.options[0])}">
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Option B</label>
                        <input type="text" placeholder="Option B" required class="w-full bg-gray-950/40 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-neonCyan transition-all q-opt-input" data-index="1" value="${escapeHtml(q.options[1])}">
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Option C</label>
                        <input type="text" placeholder="Option C" required class="w-full bg-gray-950/40 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-neonCyan transition-all q-opt-input" data-index="2" value="${escapeHtml(q.options[2])}">
                      </div>
                      <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Option D</label>
                        <input type="text" placeholder="Option D" required class="w-full bg-gray-950/40 border border-gray-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-neonCyan transition-all q-opt-input" data-index="3" value="${escapeHtml(q.options[3])}">
                      </div>
                    </div>
                  </div>

                  <div class="flex flex-col justify-between">
                    <div>
                      <label class="block text-xs font-semibold text-gray-400 uppercase mb-2">Correct Option</label>
                      <select class="w-full bg-gray-950/40 border border-gray-800 rounded-lg px-3 py-2.5 text-xs focus:outline-none focus:border-neonCyan transition-all q-correct-select">
                        <option value="0" ${q.correctOption === 0 ? 'selected' : ''}>Option A</option>
                        <option value="1" ${q.correctOption === 1 ? 'selected' : ''}>Option B</option>
                        <option value="2" ${q.correctOption === 2 ? 'selected' : ''}>Option C</option>
                        <option value="3" ${q.correctOption === 3 ? 'selected' : ''}>Option D</option>
                      </select>
                    </div>
                    
                    <button type="button" class="w-full mt-4 py-2 border border-rose-500/30 text-rose-400 bg-rose-950/10 hover:bg-rose-950/30 rounded-xl text-xs font-medium transition-all duration-200 btn-delete-question">
                      <i class="fa-solid fa-trash-can mr-2"></i>Delete Question
                    </button>
                  </div>
                </div>
              </div>
            `;
            const wrapper = document.createElement('div');
            wrapper.innerHTML = newQuestionHTML;
            listContainer.appendChild(wrapper.firstElementChild);
          });

          // Refresh states
          updateQuestionPanelStates();
          showToast(`Successfully imported ${importedQuestions.length} questions!`, true);
          audio.playVictory();
        } catch (err) {
          showToast(err.message || "Failed to parse questions file.", false);
        } finally {
          importFileInput.value = '';
        }
      };
      reader.readAsText(file);
    });
  }

  // Submit and create the quiz
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      audio.playClick();
      
      const title = document.getElementById('create-quiz-title').value.trim();
      const description = document.getElementById('create-quiz-desc').value.trim();
      const genre = document.getElementById('create-quiz-genre').value;
      const timeLimit = parseInt(document.getElementById('create-quiz-time').value);

      // Gather Questions
      const questions = [];
      const panels = listContainer.querySelectorAll('.question-panel');
      let isValid = true;

      panels.forEach((panel, idx) => {
        const textVal = panel.querySelector('.q-text-input').value.trim();
        const optionsInputs = panel.querySelectorAll('.q-opt-input');
        const correctVal = parseInt(panel.querySelector('.q-correct-select').value);

        const options = [];
        optionsInputs.forEach(input => {
          options.push(input.value.trim());
        });

        if (!textVal || options.some(opt => !opt)) {
          isValid = false;
          return;
        }

        questions.push({
          questionText: textVal,
          options: options,
          correctOption: correctVal
        });
      });

      if (!isValid) {
        showToast("Please fully fill out all question details and options.", false);
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Publishing Quiz...`;

      try {
        const quizId = await dbService.saveQuiz({
          title, description, genre, timeLimit, questions
        }, currentUser);

        showToast(`Quiz Published successfully! Code: ${quizId}`, true);
        
        // Play dynamic victory sound when quiz creates successfully!
        audio.playVictory();

        // Redirect to Leaderboard displaying the published code details
        activeQuizIdForLeaderboard = quizId;
        switchView('leaderboard');
      } catch (err) {
        showToast(err.message, false);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Publish Quiz & Get Code</span><i class="fa-solid fa-paper-plane"></i>`;
      }
    });
  }
}

// -------------------------------------------------------------
// Active Playroom Quiz Playback Engine
// -------------------------------------------------------------
function launchQuizArena(quiz) {
  activeQuiz = quiz;
  quizQuestions = quiz.questions || [];
  currentQuestionIndex = 0;
  quizScore = 0;
  userSelections = [];
  questionTimeLimit = parseInt(quiz.timeLimit) || 30;

  // Header display details
  document.getElementById('play-quiz-title').textContent = quiz.title;
  const genreBadge = document.getElementById('play-genre-badge');
  genreBadge.textContent = quiz.genre;
  
  // Set custom color accents based on genre tags
  updateGenreBadgeColors(genreBadge, quiz.genre);

  switchView('quizPlay');
  renderCurrentQuestion();
}

function renderCurrentQuestion() {
  if (currentQuestionIndex >= quizQuestions.length) {
    completeQuizAttempt();
    return;
  }

  // Clear selections
  userSelectedOption = null;

  const currentQuestion = quizQuestions[currentQuestionIndex];
  
  // Update progress texts
  document.getElementById('play-question-num-txt').textContent = `Question ${currentQuestionIndex + 1} of ${quizQuestions.length}`;
  
  const percentage = Math.round((currentQuestionIndex / quizQuestions.length) * 100);
  document.getElementById('play-progress-percent').textContent = `${percentage}%`;
  document.getElementById('play-progress-bar').style.width = `${percentage}%`;

  // Update question title
  document.getElementById('play-question-text').textContent = currentQuestion.questionText;

  // Populate options grid
  const optionsList = document.getElementById('play-options-list');
  optionsList.innerHTML = '';

  const choiceLetters = ['A', 'B', 'C', 'D'];
  currentQuestion.options.forEach((optionText, idx) => {
    const btn = document.createElement('button');
    btn.className = "flex items-center space-x-4 p-5 rounded-2xl border border-gray-800 bg-gray-950/30 hover:border-neonCyan transition-all hover:bg-gray-900/45 text-left w-full group relative overflow-hidden active:scale-98";
    btn.innerHTML = `
      <span class="w-8 h-8 rounded-lg bg-white/5 border border-glassBorder flex items-center justify-center font-display font-semibold text-sm text-gray-400 group-hover:text-neonCyan group-hover:border-neonCyan transition-all opt-indicator">${choiceLetters[idx]}</span>
      <span class="text-sm text-gray-300 font-medium group-hover:text-white transition-colors">${optionText}</span>
    `;

    btn.addEventListener('click', () => {
      audio.playClick();
      selectOption(idx, btn);
    });

    optionsList.appendChild(btn);
  });

  // Launch Question Ticking Loop
  startQuestionTimer();
}

function selectOption(index, buttonElement) {
  userSelectedOption = index;

  // Reset border styling on other buttons
  const optionsList = document.getElementById('play-options-list');
  optionsList.querySelectorAll('button').forEach((btn) => {
    btn.className = "flex items-center space-x-4 p-5 rounded-2xl border border-gray-800 bg-gray-950/30 hover:border-neonCyan transition-all hover:bg-gray-900/45 text-left w-full group relative overflow-hidden active:scale-98";
    const indicator = btn.querySelector('.opt-indicator');
    if (indicator) {
      indicator.className = "w-8 h-8 rounded-lg bg-white/5 border border-glassBorder flex items-center justify-center font-display font-semibold text-sm text-gray-400 group-hover:text-neonCyan group-hover:border-neonCyan transition-all opt-indicator";
    }
  });

  // Highlight selected button
  buttonElement.className = "flex items-center space-x-4 p-5 rounded-2xl border border-neonCyan bg-neonCyan/10 shadow-neon-cyan transition-all text-left w-full group relative overflow-hidden";
  const selectIndicator = buttonElement.querySelector('.opt-indicator');
  if (selectIndicator) {
    selectIndicator.className = "w-8 h-8 rounded-lg bg-neonCyan text-darkBg border border-neonCyan flex items-center justify-center font-display font-bold text-sm opt-indicator";
  }
}

function startQuestionTimer() {
  if (quizTimer) clearInterval(quizTimer);

  quizTimeLeft = questionTimeLimit;
  const timerSecondsText = document.getElementById('play-timer-seconds');
  const timerCircleProgress = document.getElementById('timer-progress');
  
  timerSecondsText.textContent = quizTimeLeft;
  
  // Fully wrap circle dash properties (176 stroke length)
  timerCircleProgress.style.strokeDashoffset = '0';
  timerCircleProgress.setAttribute('stroke', '#00f2fe');

  quizTimer = setInterval(() => {
    quizTimeLeft--;
    timerSecondsText.textContent = quizTimeLeft;
    
    // Animate circular clock ring
    const dashoffset = 176 - (176 * (quizTimeLeft / questionTimeLimit));
    timerCircleProgress.style.strokeDashoffset = dashoffset;

    // Change colors as countdown becomes critical
    if (quizTimeLeft <= 5) {
      timerCircleProgress.setAttribute('stroke', '#ff007f'); // Neon Pink alarm
      audio.playTick(); // synthesize a clicking tick
    } else {
      timerCircleProgress.setAttribute('stroke', '#00f2fe');
    }

    if (quizTimeLeft <= 0) {
      clearInterval(quizTimer);
      audio.playCountdownEnd(); // synthesize low buzzer
      showToast("Time's up for this question!", false);
      advanceQuizState();
    }
  }, 1000);
}

function advanceQuizState() {
  // Lock response checking
  const currentQuestion = quizQuestions[currentQuestionIndex];
  if (currentQuestion) {
    userSelections.push(userSelectedOption);
    
    if (userSelectedOption !== null && userSelectedOption === currentQuestion.correctOption) {
      quizScore++;
      audio.playCorrect();
    } else if (userSelectedOption !== null) {
      audio.playWrong();
    }
  }

  currentQuestionIndex++;
  renderCurrentQuestion();
}

function renderReviewSheet() {
  const reviewList = document.getElementById('review-list');
  if (!reviewList) return;

  reviewList.innerHTML = '';
  const choiceLetters = ['A', 'B', 'C', 'D'];

  quizQuestions.forEach((q, qIdx) => {
    const selectedOption = userSelections[qIdx];
    const correctOption = q.correctOption;
    
    let statusBadge = '';
    let borderLeftClass = '';
    
    if (selectedOption === null || selectedOption === undefined) {
      statusBadge = `<span class="px-3 py-1 bg-neonYellow/20 border border-neonYellow/30 rounded-full text-[10px] font-bold text-neonYellow uppercase flex items-center"><i class="fa-regular fa-clock mr-1"></i>Timed Out</span>`;
      borderLeftClass = 'border-l-neonYellow shadow-neon-yellow/5';
    } else if (selectedOption === correctOption) {
      statusBadge = `<span class="px-3 py-1 bg-neonGreen/20 border border-neonGreen/30 rounded-full text-[10px] font-bold text-neonGreen uppercase flex items-center"><i class="fa-solid fa-circle-check mr-1"></i>Correct</span>`;
      borderLeftClass = 'border-l-neonGreen shadow-neon-green/5';
    } else {
      statusBadge = `<span class="px-3 py-1 bg-neonPink/20 border border-neonPink/30 rounded-full text-[10px] font-bold text-neonPink uppercase flex items-center"><i class="fa-solid fa-circle-xmark mr-1"></i>Incorrect</span>`;
      borderLeftClass = 'border-l-neonPink shadow-neon-pink/5';
    }

    const optionsHtml = q.options.map((optText, optIdx) => {
      let optionClass = "flex items-center space-x-3 p-3.5 rounded-xl border text-xs font-medium transition-all duration-200 bg-white/5 border-glassBorder text-gray-300";
      let indicatorHtml = `<span class="w-6 h-6 rounded bg-white/5 border border-glassBorder flex items-center justify-center font-display font-bold text-[10px] text-gray-500">${choiceLetters[optIdx]}</span>`;
      let suffixHtml = '';

      if (optIdx === correctOption) {
        optionClass = "flex items-center space-x-3 p-3.5 rounded-xl border text-xs font-bold transition-all duration-200 bg-neonGreen/10 border-neonGreen/40 text-neonGreen shadow-neon-green/5";
        indicatorHtml = `<span class="w-6 h-6 rounded bg-neonGreen text-darkBg border border-neonGreen flex items-center justify-center font-display font-extrabold text-[10px]"><i class="fa-solid fa-check"></i></span>`;
        suffixHtml = `<span class="ml-auto text-[9px] font-bold uppercase tracking-wider text-neonGreen bg-neonGreen/10 px-2 py-0.5 rounded border border-neonGreen/20">Correct Option</span>`;
      } else if (optIdx === selectedOption) {
        optionClass = "flex items-center space-x-3 p-3.5 rounded-xl border text-xs font-bold transition-all duration-200 bg-neonPink/10 border-neonPink/40 text-neonPink shadow-neon-pink/5";
        indicatorHtml = `<span class="w-6 h-6 rounded bg-neonPink text-white border border-neonPink flex items-center justify-center font-display font-extrabold text-[10px]"><i class="fa-solid fa-xmark"></i></span>`;
        suffixHtml = `<span class="ml-auto text-[9px] font-bold uppercase tracking-wider text-neonPink bg-neonPink/10 px-2 py-0.5 rounded border border-neonPink/20">Your Choice</span>`;
      }

      return `
        <div class="${optionClass}">
          ${indicatorHtml}
          <span>${escapeHtml(optText)}</span>
          ${suffixHtml}
        </div>
      `;
    }).join('');

    const questionCard = `
      <div class="glass-panel rounded-2xl p-5 border border-glassBorder border-l-4 ${borderLeftClass} space-y-4 hover:scale-[1.01] transition-transform duration-200">
        <div class="flex justify-between items-center">
          <span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Question #${qIdx + 1} of ${quizQuestions.length}</span>
          ${statusBadge}
        </div>
        <p class="text-sm font-semibold text-white leading-relaxed">${escapeHtml(q.questionText)}</p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          ${optionsHtml}
        </div>
      </div>
    `;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = questionCard;
    reviewList.appendChild(wrapper.firstElementChild);
  });
}

function setupGameplayActions() {
  const btnNext = document.getElementById('btn-next-question');
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      audio.playClick();
      if (userSelectedOption === null) {
        showToast("Please choose an answer first, or let the timer run out.", false);
        return;
      }
      
      if (quizTimer) clearInterval(quizTimer);
      advanceQuizState();
    });
  }

  const btnReview = document.getElementById('btn-review-answers');
  const reviewPanel = document.getElementById('review-answers-panel');
  if (btnReview && reviewPanel) {
    btnReview.addEventListener('click', (e) => {
      e.preventDefault();
      audio.playClick();
      
      const isHidden = reviewPanel.classList.contains('hidden');
      if (isHidden) {
        renderReviewSheet();
        reviewPanel.classList.remove('hidden');
        
        setTimeout(() => {
          reviewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      } else {
        reviewPanel.classList.add('hidden');
      }
    });
  }
}

async function completeQuizAttempt() {
  if (quizTimer) clearInterval(quizTimer);
  
  audio.playVictory();
  
  // Reset the review panel and lists
  const reviewPanel = document.getElementById('review-answers-panel');
  if (reviewPanel) reviewPanel.classList.add('hidden');
  
  const reviewList = document.getElementById('review-list');
  if (reviewList) reviewList.innerHTML = '';
  
  switchView('results');

  const percentage = Math.round((quizScore / quizQuestions.length) * 100);
  
  // Results summary populate
  document.getElementById('result-quiz-title').textContent = activeQuiz.title;
  document.getElementById('result-score-percent').textContent = `${percentage}%`;
  document.getElementById('result-score-fraction').textContent = `${quizScore} of ${quizQuestions.length} Correct`;
  document.getElementById('result-correct-count').textContent = quizScore;
  document.getElementById('result-genre').textContent = activeQuiz.genre;

  // Add colors based on performance
  const scoreBadge = document.getElementById('result-score-percent');
  if (percentage >= 70) {
    scoreBadge.className = "font-display font-extrabold text-4xl text-neonGreen text-glow-green";
  } else if (percentage >= 40) {
    scoreBadge.className = "font-display font-extrabold text-4xl text-neonYellow text-glow-yellow";
  } else {
    scoreBadge.className = "font-display font-extrabold text-4xl text-neonPink text-glow-pink";
  }

  // Save score results in database asynchronously
  try {
    await dbService.saveAttempt(
      activeQuiz.id,
      activeQuiz.title,
      activeQuiz.genre,
      quizScore,
      quizQuestions.length,
      currentUser
    );
    showToast("Attempt logged in real-time server database!", true);
  } catch (err) {
    showToast("Failed to save score. Check internet.", false);
  }

  // Bind Results page navigation actions
  const btnLead = document.getElementById('btn-view-leaderboard');
  if (btnLead) {
    btnLead.addEventListener('click', () => {
      audio.playClick();
      activeQuizIdForLeaderboard = activeQuiz.id;
      switchView('leaderboard');
    });
  }

  const btnDash = document.getElementById('btn-result-dashboard');
  if (btnDash) {
    btnDash.addEventListener('click', () => {
      audio.playClick();
      switchView('dashboard');
    });
  }
}

// -------------------------------------------------------------
// Real-Time Leaderboards Engine
// -------------------------------------------------------------
function setupLeaderboardToggles() {
  const tabQuiz = document.getElementById('lead-scope-quiz');
  const tabGlobal = document.getElementById('lead-scope-global');
  const searchBar = document.getElementById('lead-room-search-bar');
  const btnSearch = document.getElementById('btn-lead-search');
  const playerSearchInput = document.getElementById('lead-player-name-input');
  const btnPlayerSearch = document.getElementById('btn-lead-player-search');

  const filterLeaderboardByPlayerName = () => {
    const q = playerSearchInput ? playerSearchInput.value.trim().toLowerCase() : '';
    const isGlobal = (currentLeaderboardScope === 'global');
    
    if (!q) {
      const originalSliced = isGlobal ? currentLeaderboardEntries.slice(0, 10) : currentLeaderboardEntries;
      renderLeaderboardTable(originalSliced, isGlobal);
      return;
    }

    const filtered = currentLeaderboardEntries.filter(u => 
      (u.username || '').toLowerCase().includes(q)
    );
    renderLeaderboardTable(filtered, isGlobal);
  };

  if (tabQuiz && tabGlobal) {
    tabQuiz.addEventListener('click', () => {
      audio.playClick();
      currentLeaderboardScope = 'quiz';
      tabQuiz.className = "px-4 py-2 text-xs font-bold rounded-lg text-white bg-white/10 shadow-sm transition-all duration-200";
      tabGlobal.className = "px-4 py-2 text-xs font-bold rounded-lg text-gray-400 hover:text-white transition-all duration-200";
      if (searchBar) searchBar.classList.remove('hidden');
      if (playerSearchInput) playerSearchInput.value = '';
      loadLeaderboardView();
    });

    tabGlobal.addEventListener('click', () => {
      audio.playClick();
      currentLeaderboardScope = 'global';
      tabGlobal.className = "px-4 py-2 text-xs font-bold rounded-lg text-white bg-white/10 shadow-sm transition-all duration-200";
      tabQuiz.className = "px-4 py-2 text-xs font-bold rounded-lg text-gray-400 hover:text-white transition-all duration-200";
      if (searchBar) searchBar.classList.add('hidden');
      if (playerSearchInput) playerSearchInput.value = '';
      loadLeaderboardView();
    });
  }

  // Search click handler
  if (btnSearch) {
    btnSearch.addEventListener('click', () => {
      audio.playClick();
      const code = document.getElementById('lead-quiz-id-input').value.trim().toUpperCase();
      if (!code) {
        showToast("Please enter a room code.", false);
        return;
      }
      activeQuizIdForLeaderboard = code;
      loadLeaderboardView();
    });
  }

  // Player name search event listeners
  if (playerSearchInput) {
    playerSearchInput.addEventListener('input', filterLeaderboardByPlayerName);
  }

  if (btnPlayerSearch) {
    btnPlayerSearch.addEventListener('click', () => {
      audio.playClick();
      filterLeaderboardByPlayerName();
    });
  }
}

async function loadLeaderboardView() {
  // Clear any existing active database listeners to prevent resource leaks
  if (unsubscribeLeaderboard) {
    unsubscribeLeaderboard();
    unsubscribeLeaderboard = null;
  }

  const containerDetails = document.getElementById('lead-quiz-details');
  const rowsList = document.getElementById('leaderboard-rows-list');
  const leadRoomSearch = document.getElementById('lead-room-search-bar');

  // Reset top podium placements
  resetPodiumUI();

  // Reset player search box
  const playerSearchInput = document.getElementById('lead-player-name-input');
  if (playerSearchInput) playerSearchInput.value = '';

  if (currentLeaderboardScope === 'global') {
    if (containerDetails) containerDetails.classList.add('hidden');
    if (leadRoomSearch) leadRoomSearch.classList.add('hidden');

    rowsList.innerHTML = `<tr><td colspan="4" class="text-center text-gray-500 py-10"><i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Loading Global Standings...</td></tr>`;

    try {
      const champions = await dbService.getGlobalLeaderboard();
      // Store rank index on entries before slice/filter
      champions.forEach((c, idx) => {
        c.rank = idx + 1;
      });
      currentLeaderboardEntries = champions;
      renderLeaderboardTable(champions.slice(0, 10), true);
    } catch (e) {
      rowsList.innerHTML = `<tr><td colspan="4" class="text-center text-rose-400 py-10">Failed to load global standings.</td></tr>`;
    }
    
  } else {
    // Current quiz room leaderboard
    if (leadRoomSearch) leadRoomSearch.classList.remove('hidden');

    // If no active code has been set, request user search
    if (!activeQuizIdForLeaderboard) {
      if (containerDetails) containerDetails.classList.add('hidden');
      rowsList.innerHTML = `<tr><td colspan="4" class="text-center text-gray-500 py-10">Search for a Quiz Room Code to load its leaderboard!</td></tr>`;
      return;
    }

    // Set search box value
    document.getElementById('lead-quiz-id-input').value = activeQuizIdForLeaderboard;

    rowsList.innerHTML = `<tr><td colspan="4" class="text-center text-gray-500 py-10"><i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Accessing Room Leaderboard...</td></tr>`;

    try {
      // 1. Fetch Room Meta once
      const quiz = await dbService.getQuiz(activeQuizIdForLeaderboard);
      
      // Update details banner
      if (containerDetails) {
        containerDetails.classList.remove('hidden');
        document.getElementById('lead-badge-genre').textContent = quiz.genre;
        updateGenreBadgeColors(document.getElementById('lead-badge-genre'), quiz.genre);
        document.getElementById('lead-text-title').textContent = quiz.title;
        document.getElementById('lead-text-desc').textContent = quiz.description || "No description provided.";
        document.getElementById('lead-text-code').textContent = quiz.id;
      }

      // 2. Open active real-time socket connection listener for live ranking shifts!
      unsubscribeLeaderboard = dbService.listenToQuizLeaderboard(activeQuizIdForLeaderboard, (attempts) => {
        // Store rank index on entries before slice/filter
        attempts.forEach((a, idx) => {
          a.rank = idx + 1;
        });
        currentLeaderboardEntries = attempts;

        // If there is any active search filter text, apply it on live updates!
        const playerSearchVal = playerSearchInput ? playerSearchInput.value.trim().toLowerCase() : '';
        if (playerSearchVal) {
          const filtered = attempts.filter(a => (a.username || '').toLowerCase().includes(playerSearchVal));
          renderLeaderboardTable(filtered, false);
        } else {
          renderLeaderboardTable(attempts, false);
        }
      });

    } catch (err) {
      if (containerDetails) containerDetails.classList.add('hidden');
      rowsList.innerHTML = `<tr><td colspan="4" class="text-center text-rose-400 py-10">${err.message}</td></tr>`;
    }
  }
}

function resetPodiumUI() {
  const placements = [1, 2, 3];
  placements.forEach(rank => {
    document.getElementById(`podium-${rank}-name`).textContent = "--";
    document.getElementById(`podium-${rank}-score`).textContent = "--";
    const avatar = document.getElementById(`podium-${rank}-avatar`);
    if (avatar) {
      // clear background colors except original
      avatar.innerHTML = rank;
    }
  });
}

function renderLeaderboardTable(entries, isGlobal = false) {
  const rowsList = document.getElementById('leaderboard-rows-list');
  
  if (!entries || entries.length === 0) {
    rowsList.innerHTML = `<tr><td colspan="4" class="text-center text-gray-500 py-10">No scores recorded yet. Be the first to join the room!</td></tr>`;
    resetPodiumUI();
    return;
  }

  // Populate Podium (Top 3)
  const podiumConfig = [
    { rank: 1, colorClass: 'text-neonYellow border-neonYellow bg-amber-950/20 shadow-neon-yellow' },
    { rank: 2, colorClass: 'text-slate-300 border-slate-400 bg-slate-900/30' },
    { rank: 3, colorClass: 'text-orange-400 border-orange-500 bg-orange-950/20' }
  ];

  podiumConfig.forEach(cfg => {
    const entryIndex = cfg.rank - 1;
    const nameEl = document.getElementById(`podium-${cfg.rank}-name`);
    const scoreEl = document.getElementById(`podium-${cfg.rank}-score`);
    const avatarEl = document.getElementById(`podium-${cfg.rank}-avatar`);

    if (entryIndex < entries.length) {
      const u = entries[entryIndex];
      const name = isGlobal ? u.username : u.username;
      const score = isGlobal ? `${u.totalScore} pts (${u.totalQuizzesTaken} Q)` : `${u.percentage}%`;

      nameEl.textContent = name;
      scoreEl.textContent = score;

      if (avatarEl) {
        const uppercaseInitial = (name || '?').charAt(0).toUpperCase();
        avatarEl.innerHTML = `
          ${uppercaseInitial}
          ${u.rank === 1 ? '<i class="fa-solid fa-crown absolute -top-4 left-1/2 -translate-x-1/2 text-neonYellow text-md animate-bounce"></i>' : ''}
        `;
        avatarEl.className = `w-12 h-12 md:w-14 md:h-14 rounded-full border-2 flex items-center justify-center font-display font-bold relative mb-2 ${cfg.colorClass}`;
      }
    } else {
      nameEl.textContent = "--";
      scoreEl.textContent = "--";
      if (avatarEl) {
        avatarEl.textContent = cfg.rank;
        avatarEl.className = `w-12 h-12 rounded-full border border-gray-800 bg-gray-950 flex items-center justify-center font-display font-bold text-gray-500 relative mb-2`;
      }
    }
  });

  // Populate Table listings
  rowsList.innerHTML = entries.map((u, index) => {
    const rank = u.rank || (index + 1);
    let rankBadge = `<span class="text-sm font-bold text-gray-400">${rank}</span>`;
    
    if (rank === 1) rankBadge = `<span class="w-7 h-7 rounded-full bg-neonYellow/20 border border-neonYellow/40 text-neonYellow flex items-center justify-center text-xs font-bold shadow-neon-yellow"><i class="fa-solid fa-crown text-[10px]"></i></span>`;
    else if (rank === 2) rankBadge = `<span class="w-7 h-7 rounded-full bg-slate-400/20 border border-slate-400/40 text-slate-300 flex items-center justify-center text-xs font-bold"><i class="fa-solid fa-medal text-[10px]"></i></span>`;
    else if (rank === 3) rankBadge = `<span class="w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/40 text-orange-400 flex items-center justify-center text-xs font-bold"><i class="fa-solid fa-medal text-[10px]"></i></span>`;

    const name = u.username;
    
    // Details parameters
    let scoreDisplay = '';
    let detailDisplay = '';
    
    if (isGlobal) {
      scoreDisplay = `<span class="font-bold text-white text-glow-cyan">${u.totalScore} pts</span>`;
      detailDisplay = `<span class="text-xs text-gray-500">${u.totalQuizzesTaken} Quizzes</span>`;
    } else {
      scoreDisplay = `<span class="font-bold text-neonGreen text-glow-green">${u.percentage}%</span>`;
      const dateStr = u.timestamp ? new Date(u.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';
      detailDisplay = `<span class="text-xs text-gray-500">${dateStr}</span>`;
    }

    return `
      <tr class="border-b border-glassBorder/40 hover:bg-white/5 transition-colors">
        <td class="py-4 text-center flex justify-center">${rankBadge}</td>
        <td class="py-4 pl-4">
          <div class="flex items-center space-x-3">
            <div class="w-8 h-8 rounded-lg bg-neonPurple/10 text-neonPurple border border-neonPurple/20 flex items-center justify-center font-display font-semibold text-xs uppercase">${(name || '?').charAt(0)}</div>
            <span class="text-xs font-semibold text-gray-200">${name}</span>
          </div>
        </td>
        <td class="py-4 text-center text-sm">${scoreDisplay}</td>
        <td class="py-4 text-right text-xs font-medium">${detailDisplay}</td>
      </tr>
    `;
  }).join('');
}

// -------------------------------------------------------------
// Personal Analytics Screen Actions
// -------------------------------------------------------------
async function loadProfileView() {
  if (!currentUser) return;

  const avatarBadge = document.getElementById('prof-avatar-badge');
  const usernameTxt = document.getElementById('prof-username-txt');
  const emailTxt = document.getElementById('prof-email-txt');
  const totalScoreEl = document.getElementById('prof-metric-total-score');
  const favGenreEl = document.getElementById('prof-metric-fav-genre');
  const quizzesEl = document.getElementById('prof-metric-quizzes');
  const avgAccuracyEl = document.getElementById('prof-metric-avg');

  if (avatarBadge) {
    const username = currentUser.displayName || 'Explorer';
    avatarBadge.textContent = username.charAt(0).toUpperCase();
  }
  if (usernameTxt) usernameTxt.textContent = currentUser.displayName || 'Explorer';
  if (emailTxt) emailTxt.textContent = currentUser.email || 'username@battlequiz.com';

  if (totalScoreEl) totalScoreEl.textContent = "...";
  if (favGenreEl) favGenreEl.textContent = "...";
  if (quizzesEl) quizzesEl.textContent = "...";
  if (avgAccuracyEl) avgAccuracyEl.textContent = "...";

  try {
    // 1. Fetch attempt arrays and user profile
    const attempts = await dbService.getUserAttempts(currentUser.uid);
    const profile = await authService.getUserProfile(currentUser.uid);
    
    const historyList = document.getElementById('profile-history-list');

    if (!attempts || attempts.length === 0) {
      if (totalScoreEl) totalScoreEl.textContent = profile ? (profile.totalScore || 0) : 0;
      if (favGenreEl) favGenreEl.textContent = "None";
      if (quizzesEl) quizzesEl.textContent = "0";
      if (avgAccuracyEl) avgAccuracyEl.textContent = "0%";
      
      if (historyList) {
        historyList.innerHTML = `<div class="text-center py-12 text-gray-500 text-sm">You haven't played any quizzes yet! Enter a code on the dashboard to join.</div>`;
      }

      // Render empty charts state
      renderAnalyticsCharts([]);
      return;
    }

    // Calculations
    const totalQuizzes = attempts.length;
    const totalScore = profile ? (profile.totalScore || 0) : 0;

    let totalCorrect = 0;
    let totalQuestions = 0;
    const genreTracker = {};

    attempts.forEach(att => {
      const correct = parseInt(att.score) || 0;
      const total = parseInt(att.totalQuestions) || 5;
      totalCorrect += correct;
      totalQuestions += total;
      
      if (att.genre) {
        genreTracker[att.genre] = (genreTracker[att.genre] || 0) + 1;
      }
    });

    const accuracyRate = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

    // Calculate favorite genre
    let favGenre = 'None';
    let maxCount = 0;
    Object.keys(genreTracker).forEach(genre => {
      if (genreTracker[genre] > maxCount) {
        maxCount = genreTracker[genre];
        favGenre = genre;
      }
    });

    // Populate Metrics UI
    if (totalScoreEl) totalScoreEl.textContent = totalScore;
    if (favGenreEl) favGenreEl.textContent = favGenre;
    if (quizzesEl) quizzesEl.textContent = totalQuizzes;
    if (avgAccuracyEl) avgAccuracyEl.textContent = `${accuracyRate}%`;

    // 2. Redraw custom Chart.js instances
    renderAnalyticsCharts(attempts);

    // 3. Render played quizzes timeline list with mini doughnut charts
    if (historyList) {
      const sortedLatestFirst = attempts.slice().reverse();
      
      historyList.innerHTML = sortedLatestFirst.map(att => {
        let percentColorBar = 'bg-neonPink';
        let percentTextColor = 'text-neonPink';
        if (att.percentage >= 70) {
          percentColorBar = 'bg-neonGreen';
          percentTextColor = 'text-neonGreen text-glow-green';
        } else if (att.percentage >= 40) {
          percentColorBar = 'bg-neonYellow';
          percentTextColor = 'text-neonYellow text-glow-yellow';
        } else {
          percentColorBar = 'bg-neonPink';
          percentTextColor = 'text-neonPink text-glow-pink';
        }

        const dateStr = att.timestamp ? new Date(att.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown Time';

        return `
          <div class="glass-panel rounded-2xl p-5 border border-glassBorder/60 hover:border-neonCyan/30 hover:scale-[1.005] transition-all duration-200 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
            <div class="absolute top-0 left-0 bottom-0 w-1.5 ${percentColorBar}"></div>
            
            <div class="flex-grow pl-4 space-y-2 text-left w-full">
              <div class="flex flex-wrap items-center gap-2">
                <h4 class="font-display font-bold text-white text-base leading-snug">${escapeHtml(att.quizTitle)}</h4>
                <span class="px-2 py-0.5 bg-gray-950 border border-glassBorder font-mono text-[9px] font-bold text-gray-400 rounded-md tracking-wider shadow-sm uppercase cursor-pointer hover:border-neonCyan hover:text-white transition-colors" onclick="navigator.clipboard.writeText('${att.quizId}'); showToast('Room code copied!', true);" title="Click to copy Room Code">${att.quizId}</span>
              </div>
              
              <div class="flex flex-wrap items-center gap-4 text-xs">
                <span id="badge-genre-${att.id}" class="uppercase font-extrabold text-[9px] tracking-wider"></span>
                <span class="text-gray-400 font-semibold">Score: <strong class="text-white">${att.score}</strong> / ${att.totalQuestions}</span>
                <span class="text-gray-400 font-semibold">Accuracy: <strong class="${percentTextColor}">${att.percentage}%</strong></span>
                <span class="text-gray-500 text-[10px] ml-auto font-bold flex items-center"><i class="fa-regular fa-calendar-days mr-1.5 text-neonCyan"></i>${dateStr}</span>
              </div>
            </div>
            
            <!-- Mini Doughnut Chart -->
            <div class="flex items-center justify-center bg-gray-950/40 border border-glassBorder/60 rounded-xl p-2 relative w-[140px] h-[90px]">
              <canvas id="miniChart-${att.id}"></canvas>
            </div>
          </div>
        `;
      }).join('');

      // Loop again to style genre badges and draw Charts
      sortedLatestFirst.forEach(att => {
        const badgeEl = document.getElementById(`badge-genre-${att.id}`);
        if (badgeEl) {
          badgeEl.textContent = att.genre || 'Other';
          updateGenreBadgeColors(badgeEl, att.genre || 'Other');
        }

        // Build small doughnut chart
        const ctxMini = document.getElementById(`miniChart-${att.id}`);
        if (ctxMini) {
          const correctCount = parseInt(att.score) || 0;
          const incorrectCount = (parseInt(att.totalQuestions) || 5) - correctCount;

          new window.Chart(ctxMini, {
            type: 'doughnut',
            data: {
              labels: ['Correct', 'Wrong'],
              datasets: [{
                data: [correctCount, incorrectCount],
                backgroundColor: [
                  'rgba(57, 255, 20, 0.35)', // Neon Green
                  'rgba(255, 0, 127, 0.35)'  // Neon Pink
                ],
                borderColor: [
                  '#39ff14',
                  '#ff007f'
                ],
                borderWidth: 1.5
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              cutout: '65%',
              plugins: {
                legend: { display: false },
                tooltip: {
                  enabled: true,
                  callbacks: {
                    label: function(context) {
                      return ` ${context.label}: ${context.raw}`;
                    }
                  }
                }
              }
            }
          });
        }
      });
    }

  } catch (err) {
    console.error("Failed to load user profile view stats:", err);
  }
}

// -------------------------------------------------------------
// Interactive Web Audio Sound Control
// -------------------------------------------------------------
function setupAudioControl() {
  const btn = document.getElementById('audio-toggle');
  const icon = document.getElementById('audio-icon');
  if (!btn || !icon) return;

  // Sync initial mute state
  updateAudioIcon(audio.getMuteState());

  btn.addEventListener('click', () => {
    const isMuted = audio.toggleMute();
    updateAudioIcon(isMuted);
    
    if (!isMuted) {
      // Trigger short clicks to satisfy audio-context interaction resume
      audio.playClick();
      showToast("Sounds Unmuted", true);
    } else {
      showToast("Sounds Muted", true);
    }
  });

  function updateAudioIcon(isMuted) {
    if (isMuted) {
      icon.className = "fa-solid fa-volume-xmark text-rose-500";
      btn.className = "w-10 h-10 rounded-lg flex items-center justify-center bg-rose-950/20 border border-rose-900/30 text-rose-400 hover:text-white transition-all duration-200";
    } else {
      icon.className = "fa-solid fa-volume-high text-neonCyan";
      btn.className = "w-10 h-10 rounded-lg flex items-center justify-center bg-gray-900/60 border border-glassBorder text-gray-400 hover:text-white hover:border-neonCyan transition-all duration-200";
    }
  }
}

// -------------------------------------------------------------
// Global Toast Alerts
// -------------------------------------------------------------
function showToast(message, isSuccess = true) {
  const toast = document.getElementById('global-toast');
  const text = document.getElementById('toast-message');
  const icon = document.getElementById('toast-icon');

  if (!toast || !text || !icon) return;

  text.textContent = message;

  if (isSuccess) {
    icon.className = "fa-solid fa-circle-check text-neonGreen text-xl";
    toast.className = "fixed bottom-6 right-6 z-50 transform transition-all duration-300 flex items-center space-x-3 px-5 py-4 rounded-xl glass-panel border-l-4 border-l-neonGreen shadow-neon-green pointer-events-none";
  } else {
    icon.className = "fa-solid fa-triangle-exclamation text-neonPink text-xl";
    toast.className = "fixed bottom-6 right-6 z-50 transform transition-all duration-300 flex items-center space-x-3 px-5 py-4 rounded-xl glass-panel border-l-4 border-l-neonPink shadow-neon-pink pointer-events-none";
  }

  // Slide In
  toast.classList.remove('translate-y-20', 'opacity-0');

  // Slide Out after delay
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 4000);
}

// Helper to determine custom badge accent styles for genres
function updateGenreBadgeColors(badgeElement, genreName) {
  const normalized = (genreName || '').trim().toLowerCase();
  
  if (normalized.includes('cod')) {
    badgeElement.className = "px-3 py-1 bg-neonPurple/20 border border-neonPurple/30 rounded-full text-xs font-bold text-neonPurple uppercase";
  } else if (normalized.includes('gen')) {
    badgeElement.className = "px-3 py-1 bg-neonCyan/20 border border-neonCyan/30 rounded-full text-xs font-bold text-neonCyan uppercase";
  } else if (normalized.includes('sci')) {
    badgeElement.className = "px-3 py-1 bg-neonGreen/20 border border-neonGreen/30 rounded-full text-xs font-bold text-neonGreen uppercase";
  } else if (normalized.includes('his')) {
    badgeElement.className = "px-3 py-1 bg-amber-500/20 border border-amber-500/30 rounded-full text-xs font-bold text-amber-500 uppercase";
  } else if (normalized.includes('pop')) {
    badgeElement.className = "px-3 py-1 bg-neonPink/20 border border-neonPink/30 rounded-full text-xs font-bold text-neonPink uppercase";
  } else {
    badgeElement.className = "px-3 py-1 bg-gray-500/20 border border-gray-500/30 rounded-full text-xs font-bold text-gray-400 uppercase";
  }
}
