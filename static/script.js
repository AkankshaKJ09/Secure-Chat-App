document.addEventListener('DOMContentLoaded', function() {
    const socket = io();
    let username = '';
    let rsaKey = null;
    let currentChatUser = null;
    const crypt = new JSEncrypt({ default_key_size: 2048 });
    
    // DOM Elements
    const loginSection = document.getElementById('login-section');
    const chatSection = document.getElementById('chat-section');
    const loginForm = document.getElementById('login-form');
    const onlineUsersList = document.getElementById('online-users');
    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-btn');
    const currentChatWith = document.getElementById('current-chat-with');
    const logoutBtn = document.getElementById('logout-btn');
    
    // Generate RSA keys and register user
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        username = document.getElementById('username').value.trim();
        
        if (username) {
            // Generate RSA keys
            crypt.getKey();
            const publicKey = crypt.getPublicKey();
            
            // Register with the server
            socket.emit('register', {
                username: username,
                publicKey: publicKey
            });
        }
    });
    
    // Handle registration success
    socket.on('registration_success', function(data) {
        loginSection.classList.add('d-none');
        chatSection.classList.remove('d-none');
        
        // Update online users list
        updateOnlineUsers(data.onlineUsers);
    });
    
    // Handle registration failure
    socket.on('registration_failed', function(data) {
        alert('Registration failed: ' + data.message);
    });
    
    // Update online users list
    function updateOnlineUsers(users) {
        onlineUsersList.innerHTML = '';
        users.forEach(user => {
            if (user !== username) {
                const userElement = document.createElement('div');
                userElement.className = 'list-group-item';
                userElement.innerHTML = `
                    <span class="user-status user-online"></span>
                    ${user}
                `;
                userElement.addEventListener('click', () => selectUser(user));
                onlineUsersList.appendChild(userElement);
            }
        });
    }
    
    // Handle user joined event
    socket.on('user_joined', function(user) {
        if (user !== username) {
            const userElement = document.createElement('div');
            userElement.className = 'list-group-item';
            userElement.innerHTML = `
                <span class="user-status user-online"></span>
                ${user}
            `;
            userElement.addEventListener('click', () => selectUser(user));
            onlineUsersList.appendChild(userElement);
        }
    });
    
    // Handle user left event
    socket.on('user_left', function(user) {
        const userElements = onlineUsersList.getElementsByClassName('list-group-item');
        for (let element of userElements) {
            if (element.textContent.includes(user)) {
                element.remove();
                break;
            }
        }
        
        if (currentChatUser === user) {
            currentChatUser = null;
            currentChatWith.textContent = 'Select a user to start chatting';
            messageInput.disabled = true;
            sendButton.disabled = true;
            messagesContainer.innerHTML = '';
        }
    });
    
    // Select a user to chat with
    function selectUser(user) {
        currentChatUser = user;
        currentChatWith.textContent = `Chat with ${user}`;
        messageInput.disabled = false;
        sendButton.disabled = false;
        
        // Highlight selected user
        const userElements = onlineUsersList.getElementsByClassName('list-group-item');
        for (let element of userElements) {
            if (element.textContent.includes(user)) {
                element.classList.add('active');
            } else {
                element.classList.remove('active');
            }
        }
        
        // Load messages for this user
        socket.emit('get_messages');
    }
    
    // Send message
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    function sendMessage() {
        const message = messageInput.value.trim();
        if (message && currentChatUser) {
            // Generate a random AES key for this message
            const aesKey = generateAESKey();
            
            // Encrypt the message with AES
            const encryptedMessage = encryptWithAES(aesKey, message);
            
            // Request public key of the recipient
            socket.emit('request_public_key', { username: currentChatUser });
            
            // Store the message and AES key temporarily
            const pendingMessage = {
                message: encryptedMessage,
                aesKey: aesKey
            };
            
            // Handle the public key response
            socket.once('receive_public_key', function(data) {
                // Encrypt the AES key with the recipient's public key
                const encryptor = new JSEncrypt();
                encryptor.setPublicKey(data.publicKey);
                const encryptedKey = encryptor.encrypt(pendingMessage.aesKey);
                
                // Send the encrypted message and key
                socket.emit('send_message', {
                    recipient: currentChatUser,
                    encryptedMessage: pendingMessage.message,
                    encryptedKey: encryptedKey
                });
                
                // Display the sent message
                displayMessage(username, message, new Date(), true);
                
                // Clear input
                messageInput.value = '';
            });
        }
    }
    
    // Handle incoming messages
    socket.on('new_message', function(data) {
        if (data.sender === currentChatUser) {
            // Request the sender's public key to decrypt the AES key
            socket.emit('request_public_key', { username: data.sender });
            
            socket.once('receive_public_key', function(keyData) {
                // The AES key is encrypted with our public key, so we can decrypt it with our private key
                const encryptedAesKey = data.encryptedKey;
                const aesKey = crypt.decrypt(encryptedAesKey);
                
                if (aesKey) {
                    // Decrypt the message with the AES key
                    const decryptedMessage = decryptWithAES(aesKey, data.encryptedMessage);
                    
                    // Display the message
                    displayMessage(data.sender, decryptedMessage, new Date(data.timestamp), false);
                }
            });
        }
    });
    
    // Load messages for the selected user
    socket.on('load_messages', function(messages) {
        messagesContainer.innerHTML = '';
        
        messages.forEach(msg => {
            if (msg.sender === currentChatUser || msg.sender === username) {
                // We need to decrypt messages from others
                if (msg.sender === currentChatUser) {
                    // Request the sender's public key to get the AES key
                    socket.emit('request_public_key', { username: msg.sender });
                    
                    socket.once('receive_public_key', function(keyData) {
                        const encryptedAesKey = msg.encryptedKey;
                        const aesKey = crypt.decrypt(encryptedAesKey);
                        
                        if (aesKey) {
                            const decryptedMessage = decryptWithAES(aesKey, msg.encryptedMessage);
                            displayMessage(msg.sender, decryptedMessage, new Date(msg.timestamp), msg.sender === username);
                        }
                    });
                } else {
                    // Our own messages - we have the AES key in memory or need to handle differently
                    // For simplicity, we'll just display the encrypted message
                    displayMessage(msg.sender, "[Encrypted message]", new Date(msg.timestamp), true);
                }
            }
        });
    });
    
    // Display a message in the chat
    function displayMessage(sender, message, timestamp, isSent) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${isSent ? 'sent' : 'received'}`;
        
        const timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageElement.innerHTML = `
            <div class="message-content">
                <div class="message-text">${message}</div>
                <div class="message-time">${timeString}</div>
            </div>
        `;
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    // Generate a random AES key
    function generateAESKey() {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 32; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    }
    
    // Simple AES encryption (for demonstration purposes)
    function encryptWithAES(key, message) {
        // In a real application, you would use a proper AES implementation
        // This is a simplified version for demonstration
        let result = '';
        for (let i = 0; i < message.length; i++) {
            result += String.fromCharCode(message.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return btoa(result);
    }
    
    // Simple AES decryption (for demonstration purposes)
    function decryptWithAES(key, encryptedMessage) {
        // In a real application, you would use a proper AES implementation
        // This is a simplified version for demonstration
        const decodedMessage = atob(encryptedMessage);
        let result = '';
        for (let i = 0; i < decodedMessage.length; i++) {
            result += String.fromCharCode(decodedMessage.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    }
    
    // Logout functionality
    logoutBtn.addEventListener('click', function() {
        socket.disconnect();
        window.location.reload();
    });
});