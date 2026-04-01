/**
 * Modern ToyPad Interface for Node.js 22
 * Using node-hid v3.x with proper async/await patterns
 */

const HID = require('node-hid');
const EventEmitter = require('events');

const FRAME_SIZE = 32;
const FRAME_TYPE_RESPONSE = 0x55;
const FRAME_TYPE_EVENT = 0x56;
const STATUS_OK_MASK = 0x0f;

const CMD = {
  WAKE: 0xB0,
  COLOR: 0xC0,
  FADE: 0xC2,
  FLASH: 0xC3,
  READ: 0xD2,
  WRITE: 0xD3,
  PWD: 0xE1
};

class PacketCodec {
  static encode(command, commandId, payload = Buffer.alloc(0)) {
    const frame = Buffer.alloc(FRAME_SIZE);
    frame.fill(0);
    frame[0] = FRAME_TYPE_RESPONSE;
    frame[1] = payload.length + 2;
    frame[2] = command;
    frame[3] = commandId;
    payload.copy(frame, 4);

    let checksum = 0;
    for (let i = 0; i < FRAME_SIZE; i++) {
      checksum = (checksum + frame[i]) & 0xff;
    }
    frame[payload.length + 4] = checksum;
    return frame;
  }

  static decodeIncoming(buffer) {
    if (buffer[0] === FRAME_TYPE_EVENT) {
      return {
        kind: 'event',
        pad: buffer[2],
        index: buffer[4],
        action: buffer[5],
        uid: buffer.slice(6, 13).toString('hex').toUpperCase()
      };
    }

    if (buffer[0] !== FRAME_TYPE_RESPONSE) {
      return { kind: 'unknown' };
    }

    const length = buffer[1];
    const cid = buffer[2];
    const status = buffer[3];
    if (length >= 18) {
      return {
        kind: 'read-response',
        cid,
        status,
        data: buffer.slice(4, 20)
      };
    }

    if (length === 2) {
      return {
        kind: 'short-response',
        cid,
        status,
        ok: (status & STATUS_OK_MASK) === 0
      };
    }

    return { kind: 'response', cid, status, length };
  }
}

class PendingRequests {
  constructor(owner) {
    this.owner = owner;
  }

  waitFor(eventName, timeoutMs, sendAction) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.owner.removeListener(eventName, onResult);
        reject(new Error(`${eventName} timeout`));
      }, timeoutMs);

      const onResult = (value) => {
        clearTimeout(timer);
        if (value instanceof Error) {
          reject(value);
          return;
        }
        resolve(value);
      };

      this.owner.once(eventName, onResult);
      try {
        sendAction();
      } catch (err) {
        clearTimeout(timer);
        this.owner.removeListener(eventName, onResult);
        reject(err);
      }
    });
  }
}

class ToyPad extends EventEmitter {
  constructor() {
    super();
    this.device = null;
    this.VID = 0x0E6F;
    this.PID = 0x0241;
    this.connected = false;
    this.keepAliveInterval = null;
    this.keepAliveEnabled = false;
    this.commandSequence = 1;
    this.writeMode = null;
    this.debugLog = [];
    this.maxDebugLog = 500;
    this.pending = new PendingRequests(this);
  }

  allocateCommandId() {
    const id = this.commandSequence;
    this.commandSequence = (this.commandSequence % 255) + 1;
    return id;
  }

  logDebug(message, metadata = {}) {
    this.debugLog.push({
      timestamp: new Date().toISOString(),
      message,
      metadata
    });

    if (this.debugLog.length > this.maxDebugLog) {
      this.debugLog.shift();
    }
  }

  getDebugLog() {
    return [...this.debugLog];
  }

  clearDebugLog() {
    this.debugLog = [];
  }

  /**
   * Connect to ToyPad
   */
  connect() {
    try {
      // Find ToyPad device
      const devices = HID.devices(this.VID, this.PID);
      
      if (devices.length === 0) {
        throw new Error('ToyPad not found. Make sure it is plugged in via USB.');
      }

      console.log('Found ToyPad at:', devices[0].path);
      
      // Open device
      this.device = new HID.HID(devices[0].path);
      this.connected = true;

      // Setup data handler
      this.device.on('data', (data) => {
        this.handleData(data);
      });

      this.device.on('error', (err) => {
        console.error('HID Error:', err);
        this.emit('error', err);
      });

      // Send wake command after connection with a short retry window
      setTimeout(() => {
        this.wake(3, 200);
        this.emit('ready');
      }, 300);

      return true;
    } catch (err) {
      throw new Error(`Failed to connect to ToyPad: ${err.message}`);
    }
  }

  /**
   * Send raw data to ToyPad
   * Windows HID requires report ID as first byte
   */
  sendRaw(buffer) {
    if (!this.connected || !this.device) {
      throw new Error('ToyPad not connected');
    }

    try {
      const packet = Buffer.alloc(FRAME_SIZE);
      buffer.copy(packet, 0, 0, Math.min(buffer.length, FRAME_SIZE));

      const withReportId = [0x00].concat(Array.from(packet));
      const withoutReportId = Array.from(packet);

      const tryWrite = (mode) => {
        if (mode === 'with-report-id') {
          this.device.write(withReportId);
          return;
        }
        this.device.write(withoutReportId);
      };

      // If we already know the working mode, use it directly
      if (this.writeMode) {
        try {
          tryWrite(this.writeMode);
          return true;
        } catch (cachedModeErr) {
          const alternateMode = this.writeMode === 'with-report-id'
            ? 'without-report-id'
            : 'with-report-id';

          try {
            tryWrite(alternateMode);
            this.writeMode = alternateMode;
            return true;
          } catch (alternateModeErr) {
            throw new Error(`${cachedModeErr.message} | ${alternateModeErr.message}`);
          }
        }
      }

      // Probe once and cache working mode
      try {
        tryWrite('with-report-id');
        this.writeMode = 'with-report-id';
        return true;
      } catch (errWithReportId) {
        try {
          tryWrite('without-report-id');
          this.writeMode = 'without-report-id';
          return true;
        } catch (errWithoutReportId) {
          throw new Error(`${errWithReportId.message} | ${errWithoutReportId.message}`);
        }
      }
    } catch (err) {
      // Mark device as potentially stuck
      this.deviceStuck = true;
      throw new Error(`Failed to write to ToyPad: ${err.message}`);
    }
  }

  /**
   * Check if device appears to be in stuck state
   */
  isDeviceStuck() {
    return this.deviceStuck === true;
  }

  /**
   * Attempt to recover from stuck state (requires USB replug)
   */
  requiresUSBReset() {
    if (this.deviceStuck) {
      console.log('\n⚠️  DEVICE STUCK - ACTION REQUIRED:');
      console.log('1. Unplug the ToyPad USB cable');
      console.log('2. Wait 2-3 seconds');
      console.log('3. Plug it back in');
      console.log('4. Run the script again\n');
      return true;
    }
    return false;
  }

  buildFrame(command, commandId, payload = Buffer.alloc(0)) {
    return PacketCodec.encode(command, commandId, payload);
  }

  /**
   * Send wake command to ToyPad
   */
  wake(maxRetries = 1, retryDelayMs = 150) {
    const wakePayload = Buffer.from('(c) LEGO 2014');
    const frame = this.buildFrame(CMD.WAKE, 0x01, wakePayload);

    let attempt = 0;
    const tryWake = () => {
      attempt += 1;
      try {
        this.sendRaw(frame);
        console.log('Wake command sent');
      } catch (err) {
        if (attempt < maxRetries) {
          setTimeout(tryWake, retryDelayMs);
        } else {
          console.error('Failed to send wake command:', err.message);
        }
      }
    };

    tryWake();
  }

  /**
   * Set LED color on a pad
   * @param {number} pad - 0=all, 1=center, 2=left, 3=right
   * @param {number} r - Red (0-255)
   * @param {number} g - Green (0-255)
   * @param {number} b - Blue (0-255)
   */
  setColor(pad, r, g, b) {
    const commandId = this.allocateCommandId();

    const payload = Buffer.from([pad, r, g, b]);
    const frame = this.buildFrame(CMD.COLOR, commandId, payload);
    
    try {
      this.sendRaw(frame);
      return true;
    } catch (err) {
      console.error(`Failed to set color: ${err.message}`);
      return false;
    }
  }

  /**
   * Fade LED to a color
   * @param {number} pad - 0=all, 1=center, 2=left, 3=right
   * @param {number} duration - Fade duration in ms
   * @param {number} r - Red (0-255)
   * @param {number} g - Green (0-255)
   * @param {number} b - Blue (0-255)
   */
  fade(pad, duration, r, g, b) {
    const commandId = this.allocateCommandId();

    const ticks = Math.round(duration / 10);
    const payload = Buffer.from([pad, ticks, 0x00, r, g, b]);
    const frame = this.buildFrame(CMD.FADE, commandId, payload);
    
    try {
      this.sendRaw(frame);
      return true;
    } catch (err) {
      console.error(`Failed to fade: ${err.message}`);
      return false;
    }
  }

  /**
   * Flash LED
   * @param {number} pad - 0=all, 1=center, 2=left, 3=right
   * @param {number} duration - Flash duration in ms
   * @param {number} count - Number of flashes (0=infinite)
   * @param {number} r - Red (0-255)
   * @param {number} g - Green (0-255)
   * @param {number} b - Blue (0-255)
   */
  flash(pad, duration, count, r, g, b) {
    const commandId = this.allocateCommandId();

    const onTime = Math.round(duration / 10);
    const offTime = onTime;
    const payload = Buffer.from([pad, onTime, offTime, count, r, g, b]);
    const frame = this.buildFrame(CMD.FLASH, commandId, payload);
    
    try {
      this.sendRaw(frame);
      return true;
    } catch (err) {
      console.error(`Failed to flash: ${err.message}`);
      return false;
    }
  }

  /**
   * Handle incoming data from ToyPad
   */
  handleData(data) {
    const buffer = Buffer.from(data);

    this.logDebug('packet-received', {
      type: buffer[0],
      hex: buffer.slice(0, 20).toString('hex').toUpperCase()
    });
    
    const packet = PacketCodec.decodeIncoming(buffer);
    if (packet.kind === 'event') {
      this.logDebug('tag-event', { pad: packet.pad, index: packet.index, action: packet.action });
      if (packet.action === 0) {
        this.emit('tag-added', { pad: packet.pad, index: packet.index, uid: packet.uid });
      } else if (packet.action === 1) {
        this.emit('tag-removed', { pad: packet.pad, index: packet.index, uid: packet.uid });
      }
      return;
    }

    if (packet.kind === 'read-response') {
      this.logDebug('response-packet', {
        length: 18,
        cid: packet.cid,
        status: packet.status,
        statusHex: `0x${packet.status.toString(16).padStart(2, '0')}`
      });
      this.logDebug('read-response', {
        cid: packet.cid,
        dataHex: packet.data.toString('hex').toUpperCase()
      });
      this.emit(`tag-read-${packet.cid}`, packet.data);
      this.emit(`command-response-${packet.cid}`, {
        success: true,
        status: packet.status,
        data: packet.data
      });
      return;
    }

    if (packet.kind === 'short-response' || packet.kind === 'response') {
      const isOk = packet.ok !== undefined ? packet.ok : packet.status === 0x00;
      
      this.logDebug(packet.kind, {
        cid: packet.cid,
        ok: isOk,
        status: packet.status,
        length: packet.length
      });

      this.emit(`tag-read-${packet.cid}`, new Error(`Read response had no data (status: 0x${packet.status.toString(16).padStart(2, '0')})`));
      const writeResult = isOk ? { success: true } : new Error(`Write failed with status: 0x${packet.status.toString(16).padStart(2, '0')}`);
      this.emit(`tag-write-${packet.cid}`, writeResult);
      const commandResult = isOk
        ? { success: true, status: packet.status }
        : new Error(`Command failed with status: 0x${packet.status.toString(16).padStart(2, '0')}`);
      this.emit(`command-response-${packet.cid}`, commandResult);
      this.emit('tag-write', writeResult);
    }
  }

  /**
   * Read from NFC tag
   * @param {number} index - Tag index from tag event (usually 0, 1, or 2)
   * @param {number} page - Page number to read (0-44)
   */
  readTag(index, page) {
    const commandId = this.allocateCommandId();

    const payload = Buffer.from([index, page]);
    const frame = this.buildFrame(CMD.READ, commandId, payload);
    const eventName = `tag-read-${commandId}`;
    
    return this.pending.waitFor(eventName, 5000, () => this.sendRaw(frame));
  }

  /**
   * Write to NFC tag
   * @param {number} index - Tag index from tag event
   * @param {number} page - Page number to write (0-44)
   * @param {Buffer} data - 4 bytes of data to write
   */
  writeTag(index, page, data) {
    if (data.length !== 4) {
      throw new Error('Data must be exactly 4 bytes');
    }

    const commandId = this.allocateCommandId();

    const payload = Buffer.concat([Buffer.from([index, page]), data]);
    const frame = this.buildFrame(CMD.WRITE, commandId, payload);
    const eventName = `tag-write-${commandId}`;
    
    return this.pending.waitFor(eventName, 5000, () => this.sendRaw(frame));
  }

  /**
   * Configure ToyPad NFC password mode.
   * @param {number} type - 0=disable, 1=default UID-derived password, 2=custom password
   * @param {Buffer} customPwd - Optional 4-byte password when type=2
   */
  setPasswordMode(tagIndex, type = 1, customPwd = null) {
    if (![0, 1, 2].includes(type)) {
      throw new Error('Password mode type must be 0, 1, or 2');
    }

    const commandId = this.allocateCommandId();
    const payload = Buffer.alloc(6, 0);
    payload[0] = tagIndex;
    payload[1] = type;

    if (type === 2) {
      if (!customPwd || customPwd.length !== 4) {
        throw new Error('Custom password mode requires a 4-byte password buffer');
      }
      customPwd.copy(payload, 2);
    }

    const frame = this.buildFrame(CMD.PWD, commandId, payload);
    const eventName = `command-response-${commandId}`;
    return this.pending.waitFor(eventName, 5000, () => this.sendRaw(frame));
  }

  /**
   * Enable keep-alive to prevent Windows HID timeout
   * Sends periodic no-op commands to keep device active
   * @param {number} intervalMs - Keep-alive interval in milliseconds (default: 30000 = 30 seconds)
   */
  enableKeepAlive(intervalMs = 30000) {
    if (this.keepAliveInterval) {
      this.disableKeepAlive();
    }
    
    this.keepAliveEnabled = true;
    this.keepAliveInterval = setInterval(() => {
      if (this.connected && this.device) {
        try {
          // Send a minimal command that doesn't affect LEDs or functionality
          // Just reads the device state to keep connection alive
          // Using pad 0 with current color (black/off) as no-op
          this.setColor(0, 0, 0, 0);
        } catch (err) {
          console.error('Keep-alive ping failed:', err.message);
        }
      }
    }, intervalMs);
    
    console.log(`Keep-alive enabled (${intervalMs / 1000}s interval)`);
  }

  /**
   * Disable keep-alive
   */
  disableKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      this.keepAliveEnabled = false;
      console.log('Keep-alive disabled');
    }
  }

  /**
   * Close connection to ToyPad
   */
  close() {
    // Stop keep-alive first
    this.disableKeepAlive();
    
    if (this.device) {
      try {
        // Remove all event listeners first
        this.device.removeAllListeners('data');
        this.device.removeAllListeners('error');
        
        // Close the device
        this.device.close();
      } catch (err) {
        console.error('Error closing device:', err.message);
      } finally {
        this.device = null;
        this.connected = false;
        console.log('ToyPad disconnected');
      }
    }
  }
}

module.exports = ToyPad;
