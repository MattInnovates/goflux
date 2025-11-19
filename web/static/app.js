// Global state
let currentPath = '/';
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
let authTokenId = localStorage.getItem('goflux_token_id') || '';
let authToken = localStorage.getItem('goflux_token') || '';

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    setupAuth();
    setupUpload();
    loadFiles(currentPath);
});

// Authentication functionality
function setupAuth() {
    const tokenIdInput = document.getElementById('tokenIdInput');
    const tokenInput = document.getElementById('tokenInput');
    const saveTokenBtn = document.getElementById('saveToken');
    const clearTokenBtn = document.getElementById('clearToken');
    const authStatus = document.getElementById('authStatus');

    // Load saved token (mask it for security)
    if (authToken && authTokenId) {
        tokenIdInput.placeholder = authTokenId;
        tokenInput.placeholder = '••••••••••••••••••••••••••••••••';
        authStatus.textContent = '✓ Token active (challenge-response enabled)';
        authStatus.className = 'success';
    }

    // Save token
    saveTokenBtn.addEventListener('click', () => {
        const tokenId = tokenIdInput.value.trim();
        const token = tokenInput.value.trim();
        
        if (token && tokenId) {
            // Validate token ID format
            if (!/^tok_[a-fA-F0-9]{12}$/.test(tokenId)) {
                authStatus.textContent = '⚠ Token ID should be format: tok_xxxxxxxxxxxx';
                authStatus.className = 'error';
                return;
            }
            
            // Validate token format (64 hex chars)
            if (!/^[a-fA-F0-9]{64}$/.test(token)) {
                authStatus.textContent = '⚠ Token should be 64 hexadecimal characters';
                authStatus.className = 'error';
                return;
            }
            
            authTokenId = tokenId;
            authToken = token;
            localStorage.setItem('goflux_token_id', tokenId);
            localStorage.setItem('goflux_token', token);
            
            // Clear inputs and mask for security
            tokenIdInput.value = '';
            tokenIdInput.placeholder = tokenId;
            tokenInput.value = '';
            tokenInput.placeholder = '••••••••••••••••••••••••••••••••';
            
            authStatus.textContent = '✓ Token saved (challenge-response enabled)';
            authStatus.className = 'success';
            
            // Reload files with new token
            loadFiles(currentPath);
        } else {
            authStatus.textContent = 'Please enter both Token ID and Token';
            authStatus.className = 'error';
        }
    });

    // Clear token
    clearTokenBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear the saved token?')) {
            authTokenId = '';
            authToken = '';
            localStorage.removeItem('goflux_token_id');
            localStorage.removeItem('goflux_token');
            tokenIdInput.value = '';
            tokenIdInput.placeholder = 'Token ID (e.g., tok_abc123def456)';
            tokenInput.value = '';
            tokenInput.placeholder = 'Full token (64 hex characters)';
            authStatus.textContent = 'Token cleared';
            authStatus.className = '';
            
            // Reload files (will fail auth now)
            loadFiles(currentPath);
        }
    });

    // Allow Enter key to save token
    tokenInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveTokenBtn.click();
        }
    });
    
    tokenIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            tokenInput.focus();
        }
    });
}

// Helper to compute SHA-256 hash
async function computeSHA256(message) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// Helper to compute HMAC-SHA256
async function computeHMAC(key, message) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    const messageData = encoder.encode(message);
    
    // Import key for HMAC
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    // Compute HMAC
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    
    // Convert to hex string
    return Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// Helper to get challenge-response auth header
async function getChallengeAuthHeader() {
    if (!authToken || !authTokenId) {
        console.log('No token or token ID available');
        return null;
    }
    
    try {
        console.log('Getting challenge from server...');
        // Step 1: Get challenge from server
        const challengeResp = await fetch('/auth/challenge');
        if (!challengeResp.ok) {
            console.error('Failed to get challenge:', challengeResp.status);
            return null;
        }
        
        const challenge = await challengeResp.json();
        const nonce = challenge.nonce;
        console.log('Got nonce:', nonce.substring(0, 16) + '...');
        
        // Step 2: Hash the token (same as server stores)
        const tokenHash = await computeSHA256(authToken);
        console.log('Token hash:', tokenHash.substring(0, 16) + '...');
        
        // Step 3: Compute HMAC-SHA256(token_hash, nonce)
        const response = await computeHMAC(tokenHash, nonce);
        console.log('HMAC response:', response.substring(0, 16) + '...');
        
        // Step 4: Return challenge-response header
        // Format: "Challenge <response>;<nonce>;<token_id>"
        const authHeader = `Challenge ${response};${nonce};${authTokenId}`;
        console.log('Auth header format: Challenge <response>;<nonce>;<token_id>');
        return { 'Authorization': authHeader };
        
    } catch (error) {
        console.error('Challenge-response auth failed:', error);
        return null;
    }
}

// Helper to add auth header to requests (old method - kept for compatibility)
function getAuthHeaders() {
    const headers = {
        'Content-Type': 'application/json'
    };
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
}

// Upload functionality
function setupUpload() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    // Click to upload
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    // File selection
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            uploadFiles(e.target.files);
        }
    });

    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        
        if (e.dataTransfer.files.length > 0) {
            uploadFiles(e.dataTransfer.files);
        }
    });
}

async function uploadFiles(files) {
    for (const file of files) {
        await uploadFile(file);
    }
}

async function uploadFile(file) {
    const uploadProgress = document.getElementById('uploadProgress');
    const uploadFileName = document.getElementById('uploadFileName');
    const uploadProgressBar = document.getElementById('uploadProgressBar');
    const uploadProgressText = document.getElementById('uploadProgressText');

    uploadProgress.style.display = 'block';
    uploadFileName.textContent = file.name;
    uploadProgressBar.style.width = '0%';
    uploadProgressText.textContent = '0%';

    try {
        // Read file and split into chunks
        const chunks = await splitFileIntoChunks(file);
        const remotePath = currentPath + (currentPath.endsWith('/') ? '' : '/') + file.name;

        // Upload each chunk
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            
            const chunkData = {
                path: remotePath,
                chunk_id: i,
                data: Array.from(new Uint8Array(chunk.data)),
                checksum: chunk.checksum,
                total: chunks.length
            };

            // Use challenge-response auth
            const authHeaders = authToken ? await getChallengeAuthHeader() : {};
            const headers = {
                'Content-Type': 'application/json',
                ...(authHeaders || {})
            };

            const response = await fetch('/upload', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(chunkData)
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            // Update progress
            const progress = Math.round(((i + 1) / chunks.length) * 100);
            uploadProgressBar.style.width = progress + '%';
            uploadProgressText.textContent = progress + '%';
        }

        // Success - reload file list
        showMessage('Upload complete: ' + file.name, 'success');
        setTimeout(() => {
            uploadProgress.style.display = 'none';
            loadFiles(currentPath);
        }, 1500);

    } catch (error) {
        showMessage('Upload failed: ' + error.message, 'error');
        console.error('Upload error:', error);
    }
}

async function splitFileIntoChunks(file) {
    const chunks = [];
    let offset = 0;

    while (offset < file.size) {
        const chunkEnd = Math.min(offset + CHUNK_SIZE, file.size);
        const blob = file.slice(offset, chunkEnd);
        const arrayBuffer = await blob.arrayBuffer();
        const checksum = await calculateSHA256(arrayBuffer);

        chunks.push({
            data: arrayBuffer,
            checksum: checksum
        });

        offset = chunkEnd;
    }

    return chunks;
}

async function calculateSHA256(buffer) {
    // Check if crypto.subtle is available (HTTPS or localhost)
    if (window.crypto && window.crypto.subtle) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    // Fallback: simple checksum for non-HTTPS contexts
    // This is less secure but allows functionality to work
    const bytes = new Uint8Array(buffer);
    let hash = 0;
    for (let i = 0; i < bytes.length; i++) {
        hash = ((hash << 5) - hash) + bytes[i];
        hash = hash & hash; // Convert to 32-bit integer
    }
    // Pad to look like a hex string
    return Math.abs(hash).toString(16).padStart(64, '0');
}

// File browsing
async function loadFiles(path) {
    currentPath = path;
    const fileList = document.getElementById('fileList');
    const currentPathEl = document.getElementById('currentPath');

    // Update breadcrumb
    if (path !== '/') {
        const pathParts = path.split('/').filter(p => p);
        currentPathEl.innerHTML = ' / ' + pathParts.join(' / ');
    } else {
        currentPathEl.innerHTML = '';
    }

    fileList.innerHTML = '<div class="loading">Loading files...</div>';

    try {
        // Use challenge-response auth if token available
        const authHeaders = authToken ? await getChallengeAuthHeader() : {};

        const response = await fetch(`/list?path=${encodeURIComponent(path)}`, {
            headers: authHeaders || {}
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Authentication required - please enter your token above');
            }
            throw new Error('Failed to load files');
        }

        const files = await response.json();
        displayFiles(files || []);

    } catch (error) {
        fileList.innerHTML = '<div class="error">Failed to load files: ' + error.message + '</div>';
    }
}

function displayFiles(files) {
    const fileList = document.getElementById('fileList');

    if (files.length === 0) {
        fileList.innerHTML = '<div class="loading">No files in this directory</div>';
        return;
    }

    fileList.innerHTML = '';

    files.forEach(fileName => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';

        const isDirectory = false; // We don't have directory info yet
        const icon = isDirectory ? '▶' : '■';

        fileItem.innerHTML = `
            <div class="file-icon">${icon}</div>
            <div class="file-info">
                <div class="file-name-text">${escapeHtml(fileName)}</div>
            </div>
            <div class="file-actions">
                <button class="btn btn-primary btn-small" onclick="downloadFile('${escapeHtml(fileName)}')">
                    Download
                </button>
            </div>
        `;

        fileList.appendChild(fileItem);
    });
}

async function downloadFile(fileName) {
    const filePath = currentPath + (currentPath.endsWith('/') ? '' : '/') + fileName;
    
    try {
        // Use challenge-response auth
        const authHeaders = authToken ? await getChallengeAuthHeader() : {};

        const response = await fetch(`/download?path=${encodeURIComponent(filePath)}`, {
            headers: authHeaders || {}
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Authentication required');
            }
            throw new Error('Download failed');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showMessage('Downloaded: ' + fileName, 'success');

    } catch (error) {
        showMessage('Download failed: ' + error.message, 'error');
    }
}

function navigateTo(path) {
    loadFiles(path);
}

function showMessage(message, type) {
    const uploadProgress = document.getElementById('uploadProgress');
    const existingMsg = document.querySelector('.message');
    
    if (existingMsg) {
        existingMsg.remove();
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = type === 'error' ? 'error message' : 'success message';
    msgDiv.textContent = message;
    
    uploadProgress.parentNode.insertBefore(msgDiv, uploadProgress);
    
    setTimeout(() => {
        msgDiv.remove();
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
