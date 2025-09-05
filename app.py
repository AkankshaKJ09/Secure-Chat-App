from flask import Flask, render_template, session, request
from flask_socketio import SocketIO, emit, join_room
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.backends import default_backend
from cryptography.fernet import Fernet
import base64
import json
import os
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev_secret_key')
socketio = SocketIO(app, cors_allowed_origins="*")

# In-memory storage (for demo purposes; use a database in production)
users = {}
messages = {}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    print(f"Client disconnected: {request.sid}")
    # Remove user from users dict if they were registered
    for username, data in list(users.items()):
        if data['sid'] == request.sid:
            del users[username]
            emit('user_left', username, broadcast=True)
            break

@socketio.on('register')
def handle_register(data):
    username = data['username']
    public_key = data['publicKey']
    
    if username in users:
        emit('registration_failed', {'message': 'Username already taken'})
        return
    
    users[username] = {
        'sid': request.sid,
        'public_key': public_key,
        'online': True
    }
    
    session['username'] = username
    
    # Send list of online users to the new user
    online_users = [user for user, data in users.items() if data['online']]
    emit('registration_success', {
        'username': username,
        'onlineUsers': online_users
    })
    
    # Notify all users about the new user
    emit('user_joined', username, broadcast=True)

@socketio.on('request_public_key')
def handle_public_key_request(data):
    target_user = data['username']
    if target_user in users:
        emit('receive_public_key', {
            'username': target_user,
            'publicKey': users[target_user]['public_key']
        })
    else:
        emit('public_key_error', {
            'message': f'User {target_user} not found'
        })

@socketio.on('send_message')
def handle_send_message(data):
    sender = session.get('username')
    if not sender:
        return
    
    recipient = data['recipient']
    encrypted_message = data['encryptedMessage']
    encrypted_key = data['encryptedKey']
    
    # Store message (encrypted)
    if recipient not in messages:
        messages[recipient] = []
    
    messages[recipient].append({
        'sender': sender,
        'encryptedMessage': encrypted_message,
        'encryptedKey': encrypted_key,
        'timestamp': datetime.now().isoformat()
    })
    
    # Notify recipient if online
    if recipient in users and users[recipient]['online']:
        emit('new_message', {
            'sender': sender,
            'encryptedMessage': encrypted_message,
            'encryptedKey': encrypted_key,
            'timestamp': datetime.now().isoformat()
        }, room=users[recipient]['sid'])

@socketio.on('get_messages')
def handle_get_messages():
    username = session.get('username')
    if username and username in messages:
        emit('load_messages', messages[username])
    else:
        emit('load_messages', [])

if __name__ == '__main__':
    socketio.run(app, debug=True)