
// ==UserScript==
// @name         Erply ID Check
// @namespace    http://robotchicken24.dev/
// @version      1.0
// @description  Checks or verifies customer ID in Erply
// @author       robotchicken24
// @match        https://*.erply.com/*
// @grant        none
// @require      https://cdn.jsdelivr.net/gh/robotchicken24/92810b374c88c7892aadb0c8a9491c46/raw/erply-idcheck.js
// ==/UserScript==




 // ERPLY POS ID Check and Age Verification System
// This script monitors product scans, displays ID check notifications, and verifies customer age from ID barcodes

(function() {
    'use strict';

    // Configuration: Product groups requiring ID check
    const AGE_RESTRICTED_GROUPS = [
        'Tobacco',
        'chewing/pouches',
        'Cigarette',
        'Cigar/Cigarillo',
        'Smoking Accessories',
        'Vapor + Accessories',
        'Alcohol',
        'Tall Cans Beer/Seltzer',
        '6 Pack Beer/Seltzer',
        'Case Beer/Seltzer',
        'Wine'
    ];

    // Age requirements
    const MINIMUM_AGE = 21;

    // Track ID check status per transaction
    let idCheckShownForTransaction = false;
    let ageVerifiedForTransaction = false;
    let currentTransactionId = null;
    let scannedCustomerInfo = null;

    // Notification messages
    const ID_CHECK_MESSAGE = "ID CHECK REQUIRED -- PLEASE ASK CUSTOMER FOR VALID ID";
    const SCAN_ID_MESSAGE = "SCAN CUSTOMER'S ID BARCODE TO VERIFY AGE";

    /**
     * Initialize the ID check system
     */
    function initializeIdCheckSystem() {
        console.log('ERPLY ID Check and Age Verification System initialized');

        // Hook into ERPLY's product scan events
        if (typeof ERPLY !== 'undefined' && ERPLY.POS) {
            // Method 1: Hook into product scan event
            if (ERPLY.POS.onProductScanned) {
                const originalScanHandler = ERPLY.POS.onProductScanned;
                ERPLY.POS.onProductScanned = function(product, transaction) {
                    handleProductScan(product, transaction);
                    return originalScanHandler.call(this, product, transaction);
                };
            }

            // Method 2: Hook into barcode scan events for ID scanning
            if (ERPLY.POS.onBarcodeScanned) {
                const originalBarcodeHandler = ERPLY.POS.onBarcodeScanned;
                ERPLY.POS.onBarcodeScanned = function(barcode, context) {
                    if (handleIdBarcodeScan(barcode)) {
                        return; // ID barcode handled, don't process as product
                    }
                    return originalBarcodeHandler.call(this, barcode, context);
                };
            }

            // Method 3: Hook into transaction events
            if (ERPLY.POS.onTransactionStart) {
                const originalTransactionStart = ERPLY.POS.onTransactionStart;
                ERPLY.POS.onTransactionStart = function(transaction) {
                    handleTransactionStart(transaction);
                    return originalTransactionStart.call(this, transaction);
                };
            }
        }

        // Setup keyboard event listener for ID scanning
        setupIdScanListener();

        // Alternative: Monitor DOM changes for product additions
        setupDOMObserver();

        // Alternative: Poll for transaction changes
        setupTransactionMonitor();
    }

    /**
     * Handle product scan event
     */
    function handleProductScan(product, transaction) {
        console.log('Product scanned:', product);

        // Check if this is a new transaction
        if (transaction && transaction.id !== currentTransactionId) {
            resetForNewTransaction(transaction.id);
        }

        // Check if product requires ID verification
        if (requiresIdCheck(product)) {
            if (!ageVerifiedForTransaction) {
                showIdCheckNotification(product);
            } else {
                console.log('Age already verified for this transaction');
            }
        }
    }

    /**
     * Handle ID barcode scan
     */
    function handleIdBarcodeScan(barcode) {
        console.log('Barcode scanned:', barcode);

        // Check if this looks like an ID barcode
        const idData = parseIdBarcode(barcode);
        if (idData) {
            console.log('ID barcode detected:', idData);
            verifyCustomerAge(idData);
            return true; // Indicate this was an ID barcode
        }

        return false; // Not an ID barcode
    }

    /**
     * Parse ID barcode data
     */
    function parseIdBarcode(barcode) {
        try {
            // Driver's License barcodes typically start with specific codes
            // PDF417 format is most common for US driver's licenses

            // Check for common ID barcode patterns
            if (barcode.length < 50) {
                return null; // Too short to be a driver's license barcode
            }

            let parsedData = null;

            // Try AAMVA format (most US driver's licenses)
            if (barcode.startsWith('@') || barcode.includes('ANSI')) {
                parsedData = parseAAMVABarcode(barcode);
            }

            // Try other common formats
            if (!parsedData && barcode.length > 100) {
                parsedData = parseGenericIdBarcode(barcode);
            }

            return parsedData;
        } catch (e) {
            console.log('Error parsing ID barcode:', e);
            return null;
        }
    }

    /**
     * Parse AAMVA standard driver's license barcode
     */
    function parseAAMVABarcode(barcode) {
        try {
            const data = {};

            // Common AAMVA field codes
            const fieldMappings = {
                'DAA': 'fullName',
                'DAB': 'lastName',
                'DAC': 'firstName',
                'DAD': 'middleName',
                'DBB': 'dateOfBirth', // MMDDYYYY format
                'DBA': 'expirationDate', // MMDDYYYY format
                'DAG': 'address1',
                'DAH': 'address2',
                'DAI': 'city',
                'DAJ': 'state',
                'DAK': 'zipCode',
                'DAQ': 'licenseNumber',
                'DBC': 'sex', // M/F
                'DBD': 'issueDate' // MMDDYYYY format
            };

            // Split barcode into lines and parse fields
            const lines = barcode.split(/[\r\n]+/);

            for (const line of lines) {
                for (const [code, field] of Object.entries(fieldMappings)) {
                    if (line.startsWith(code)) {
                        data[field] = line.substring(3).trim();
                        break;
                    }
                }
            }

            // Validate we have essential data
            if (data.dateOfBirth && (data.firstName || data.fullName)) {
                // Convert date format if needed
                data.dateOfBirth = parseDateOfBirth(data.dateOfBirth);

                if (data.expirationDate) {
                    data.expirationDate = parseDate(data.expirationDate);
                }

                return data;
            }

            return null;
        } catch (e) {
            console.log('Error parsing AAMVA barcode:', e);
            return null;
        }
    }

    /**
     * Parse generic ID barcode (fallback method)
     */
    function parseGenericIdBarcode(barcode) {
        try {
            // Look for date patterns that might be birth dates
            const datePatterns = [
                /(\d{2})(\d{2})(\d{4})/g, // MMDDYYYY
                /(\d{4})(\d{2})(\d{2})/g, // YYYYMMDD
                /(\d{2})\/(\d{2})\/(\d{4})/g, // MM/DD/YYYY
                /(\d{4})-(\d{2})-(\d{2})/g // YYYY-MM-DD
            ];

            const data = {};

            for (const pattern of datePatterns) {
                const matches = [...barcode.matchAll(pattern)];
                for (const match of matches) {
                    const potentialDate = new Date(match[3] || match[1], (match[1] || match[2]) - 1, match[2] || match[3]);
                    const currentYear = new Date().getFullYear();

                    // Check if this could be a birth date (reasonable age range)
                    if (potentialDate.getFullYear() >= 1900 &&
                        potentialDate.getFullYear() <= currentYear - 10 &&
                        potentialDate.getFullYear() >= currentYear - 100) {
                        data.dateOfBirth = potentialDate;
                        break;
                    }
                }
                if (data.dateOfBirth) break;
            }

            return data.dateOfBirth ? data : null;
        } catch (e) {
            console.log('Error parsing generic ID barcode:', e);
            return null;
        }
    }

    /**
     * Parse date of birth from string
     */
    function parseDateOfBirth(dateString) {
        try {
            // Handle MMDDYYYY format
            if (dateString.length === 8 && /^\d{8}$/.test(dateString)) {
                const month = parseInt(dateString.substring(0, 2));
                const day = parseInt(dateString.substring(2, 4));
                const year = parseInt(dateString.substring(4, 8));
                return new Date(year, month - 1, day);
            }

            // Handle other common formats
            return new Date(dateString);
        } catch (e) {
            console.log('Error parsing date of birth:', e);
            return null;
        }
    }

    /**
     * Parse generic date
     */
    function parseDate(dateString) {
        try {
            if (dateString.length === 8 && /^\d{8}$/.test(dateString)) {
                const month = parseInt(dateString.substring(0, 2));
                const day = parseInt(dateString.substring(2, 4));
                const year = parseInt(dateString.substring(4, 8));
                return new Date(year, month - 1, day);
            }
            return new Date(dateString);
        } catch (e) {
            return null;
        }
    }

    /**
     * Verify customer age from ID data
     */
    function verifyCustomerAge(idData) {
        console.log('Verifying customer age:', idData);

        if (!idData.dateOfBirth) {
            showAgeVerificationError('Could not read date of birth from ID');
            return;
        }

        const birthDate = idData.dateOfBirth;
        const today = new Date();

        // Calculate age
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();

        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }

        console.log(`Customer age: ${age}, Birth date: ${birthDate.toDateString()}`);

        // Store customer info
        scannedCustomerInfo = {
            ...idData,
            age: age,
            birthDate: birthDate,
            scanTimestamp: new Date()
        };

        // Check if customer is old enough
        if (age >= MINIMUM_AGE) {
            ageVerifiedForTransaction = true;
            showAgeVerificationSuccess(age, idData);
        } else {
            showAgeVerificationFailure(age, MINIMUM_AGE, idData);
        }

        // Log verification event
        logAgeVerificationEvent(idData, age, age >= MINIMUM_AGE);
    }

    /**
     * Show age verification success
     */
    function showAgeVerificationSuccess(age, idData) {
        const modal = document.createElement('div');
        modal.id = 'age-verification-success';
        modal.innerHTML = `
            <div style="
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.8);
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: Arial, sans-serif;
            ">
                <div style="
                    background: #fff;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                    text-align: center;
                    max-width: 500px;
                    border: 3px solid #28a745;
                ">
                    <div style="
                        font-size: 48px;
                        color: #28a745;
                        margin-bottom: 20px;
                    ">✅</div>
                    <h2 style="
                        color: #28a745;
                        margin: 0 0 15px 0;
                        font-size: 24px;
                        font-weight: bold;
                    ">AGE VERIFIED - SALE APPROVED</h2>
                    <p style="
                        font-size: 18px;
                        margin: 15px 0;
                        color: #333;
                    ">Customer Age: <strong>${age} years old</strong></p>
                    <p style="
                        font-size: 14px;
                        color: #666;
                        margin: 10px 0;
                    ">Birth Date: ${idData.dateOfBirth ? idData.dateOfBirth.toDateString() : 'N/A'}</p>
                    <p style="
                        font-size: 14px;
                        color: #666;
                        margin: 10px 0;
                    ">Name: ${idData.firstName || ''} ${idData.lastName || idData.fullName || 'N/A'}</p>
                    <button onclick="document.getElementById('age-verification-success').remove()" style="
                        background: #28a745;
                        color: white;
                        border: none;
                        padding: 15px 30px;
                        font-size: 16px;
                        font-weight: bold;
                        border-radius: 5px;
                        cursor: pointer;
                        margin-top: 20px;
                    ">CONTINUE SALE</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Auto-focus and auto-dismiss
        setTimeout(() => {
            const button = modal.querySelector('button');
            if (button) button.focus();
        }, 100);

        // Auto-dismiss after 10 seconds
        setTimeout(() => {
            if (document.getElementById('age-verification-success')) {
                document.getElementById('age-verification-success').remove();
            }
        }, 10000);
    }

    /**
     * Show age verification failure
     */
    function showAgeVerificationFailure(age, requiredAge, idData) {
        const modal = document.createElement('div');
        modal.id = 'age-verification-failure';
        modal.innerHTML = `
            <div style="
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.9);
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: Arial, sans-serif;
            ">
                <div style="
                    background: #fff;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                    text-align: center;
                    max-width: 500px;
                    border: 3px solid #dc3545;
                ">
                    <div style="
                        font-size: 48px;
                        color: #dc3545;
                        margin-bottom: 20px;
                    ">🚫</div>
                    <h2 style="
                        color: #dc3545;
                        margin: 0 0 15px 0;
                        font-size: 24px;
                        font-weight: bold;
                    ">SALE DENIED - CUSTOMER UNDERAGE</h2>
                    <p style="
                        font-size: 18px;
                        margin: 15px 0;
                        color: #333;
                        font-weight: bold;
                    ">Customer Age: ${age} years old</p>
                    <p style="
                        font-size: 16px;
                        margin: 15px 0;
                        color: #dc3545;
                        font-weight: bold;
                    ">Must be ${requiredAge} or older</p>
                    <p style="
                        font-size: 14px;
                        color: #666;
                        margin: 10px 0;
                    ">Birth Date: ${idData.dateOfBirth ? idData.dateOfBirth.toDateString() : 'N/A'}</p>
                    <div style="
                        background: #f8d7da;
                        border: 1px solid #f5c6cb;
                        color: #721c24;
                        padding: 15px;
                        border-radius: 5px;
                        margin: 20px 0;
                        font-weight: bold;
                    ">
                        REMOVE ALL AGE-RESTRICTED ITEMS FROM TRANSACTION
                    </div>
                    <button onclick="document.getElementById('age-verification-failure').remove()" style="
                        background: #dc3545;
                        color: white;
                        border: none;
                        padding: 15px 30px;
                        font-size: 16px;
                        font-weight: bold;
                        border-radius: 5px;
                        cursor: pointer;
                        margin-top: 10px;
                    ">ACKNOWLEDGE</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Auto-focus the button
        setTimeout(() => {
            const button = modal.querySelector('button');
            if (button) button.focus();
        }, 100);

        // Play alert sound
        playAlertSound();
    }

    /**
     * Show age verification error
     */
    function showAgeVerificationError(errorMessage) {
        const modal = document.createElement('div');
        modal.id = 'age-verification-error';
        modal.innerHTML = `
            <div style="
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.8);
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: Arial, sans-serif;
            ">
                <div style="
                    background: #fff;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                    text-align: center;
                    max-width: 500px;
                    border: 3px solid #ffc107;
                ">
                    <div style="
                        font-size: 48px;
                        color: #ffc107;
                        margin-bottom: 20px;
                    ">⚠️</div>
                    <h2 style="
                        color: #ffc107;
                        margin: 0 0 15px 0;
                        font-size: 24px;
                        font-weight: bold;
                    ">ID SCAN ERROR</h2>
                    <p style="
                        font-size: 16px;
                        margin: 15px 0;
                        color: #333;
                    ">${errorMessage}</p>
                    <p style="
                        font-size: 14px;
                        margin: 15px 0;
                        color: #666;
                    ">Please manually check customer's ID or try scanning again</p>
                    <div style="margin-top: 20px;">
                        <button onclick="document.getElementById('age-verification-error').remove(); window.ERPLYIdCheck.showIdScanner();" style="
                            background: #ffc107;
                            color: #212529;
                            border: none;
                            padding: 12px 25px;
                            font-size: 14px;
                            font-weight: bold;
                            border-radius: 5px;
                            cursor: pointer;
                            margin: 5px;
                        ">TRY AGAIN</button>
                        <button onclick="document.getElementById('age-verification-error').remove(); window.ERPLYIdCheck.manualAgeVerification();" style="
                            background: #6c757d;
                            color: white;
                            border: none;
                            padding: 12px 25px;
                            font-size: 14px;
                            font-weight: bold;
                            border-radius: 5px;
                            cursor: pointer;
                            margin: 5px;
                        ">MANUAL CHECK</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    }

    /**
     * Show ID scanner interface
     */
    function showIdScanner() {
        const modal = document.createElement('div');
        modal.id = 'id-scanner-modal';
        modal.innerHTML = `
            <div style="
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.8);
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: Arial, sans-serif;
            ">
                <div style="
                    background: #fff;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                    text-align: center;
                    max-width: 500px;
                    border: 3px solid #007bff;
                ">
                    <div style="
                        font-size: 48px;
                        color: #007bff;
                        margin-bottom: 20px;
                        animation: pulse 2s infinite;
                    ">📱</div>
                    <h2 style="
                        color: #007bff;
                        margin: 0 0 15px 0;
                        font-size: 24px;
                        font-weight: bold;
                    ">SCAN CUSTOMER'S ID</h2>
                    <p style="
                        font-size: 16px;
                        margin: 15px 0;
                        color: #333;
                    ">${SCAN_ID_MESSAGE}</p>
                    <p style="
                        font-size: 14px;
                        margin: 15px 0;
                        color: #666;
                    ">Scan the barcode on the back of the customer's driver's license or state ID</p>
                    <div style="
                        background: #e3f2fd;
                        border: 1px solid #bbdefb;
                        padding: 15px;
                        border-radius: 5px;
                        margin: 20px 0;
                        font-size: 14px;
                        color: #1565c0;
                    ">
                        <strong>Waiting for ID scan...</strong><br>
                        System will automatically verify age when ID is scanned
                    </div>
                    <button onclick="document.getElementById('id-scanner-modal').remove()" style="
                        background: #6c757d;
                        color: white;
                        border: none;
                        padding: 12px 25px;
                        font-size: 14px;
                        font-weight: bold;
                        border-radius: 5px;
                        cursor: pointer;
                        margin-top: 10px;
                    ">CANCEL</button>
                </div>
            </div>
            <style>
                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); }
                }
            </style>
        `;

        document.body.appendChild(modal);

        // Auto-dismiss after 30 seconds
        setTimeout(() => {
            if (document.getElementById('id-scanner-modal')) {
                document.getElementById('id-scanner-modal').remove();
            }
        }, 30000);
    }

    /**
     * Manual age verification interface
     */
    function showManualAgeVerification() {
        const modal = document.createElement('div');
        modal.id = 'manual-age-verification';
        modal.innerHTML = `
            <div style="
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.8);
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: Arial, sans-serif;
            ">
                <div style="
                    background: #fff;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                    text-align: center;
                    max-width: 500px;
                    border: 3px solid #6c757d;
                ">
                    <div style="
                        font-size: 48px;
                        color: #6c757d;
                        margin-bottom: 20px;
                    ">👤</div>
                    <h2 style="
                        color: #6c757d;
                        margin: 0 0 15px 0;
                        font-size: 24px;
                        font-weight: bold;
                    ">MANUAL AGE VERIFICATION</h2>
                    <p style="
                        font-size: 16px;
                        margin: 15px 0;
                        color: #333;
                    ">Manually verify customer is 21 or older by checking their ID</p>
                    <div style="
                        background: #fff3cd;
                        border: 1px solid #ffeaa7;
                        color: #856404;
                        padding: 15px;
                        border-radius: 5px;
                        margin: 20px 0;
                        font-size: 14px;
                    ">
                        <strong>Important:</strong> Visually inspect the customer's government-issued photo ID to confirm they are at least 21 years old
                    </div>
                    <div style="margin-top: 20px;">
                        <button onclick="window.ERPLYIdCheck.approveManualVerification()" style="
                            background: #28a745;
                            color: white;
                            border: none;
                            padding: 15px 25px;
                            font-size: 16px;
                            font-weight: bold;
                            border-radius: 5px;
                            cursor: pointer;
                            margin: 5px;
                        ">CUSTOMER IS 21+ - APPROVE SALE</button>
                        <br>
                        <button onclick="window.ERPLYIdCheck.denyManualVerification()" style="
                            background: #dc3545;
                            color: white;
                            border: none;
                            padding: 15px 25px;
                            font-size: 16px;
                            font-weight: bold;
                            border-radius: 5px;
                            cursor: pointer;
                            margin: 5px;
                        ">CUSTOMER UNDER 21 - DENY SALE</button>
                        <br>
                        <button onclick="document.getElementById('manual-age-verification').remove()" style="
                            background: #6c757d;
                            color: white;
                            border: none;
                            padding: 12px 25px;
                            font-size: 14px;
                            font-weight: bold;
                            border-radius: 5px;
                            cursor: pointer;
                            margin: 10px 5px 5px 5px;
                        ">CANCEL</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    }

    /**
     * Setup keyboard listener for ID scanning
     */
    function setupIdScanListener() {
        let barcodeBuffer = '';
        let lastKeyTime = 0;

        document.addEventListener('keydown', function(event) {
            const currentTime = new Date().getTime();

            // If more than 100ms between keystrokes, reset buffer (human typing)
            if (currentTime - lastKeyTime > 100) {
                barcodeBuffer = '';
            }

            lastKeyTime = currentTime;

            // Add character to buffer
            if (event.key.length === 1) {
                barcodeBuffer += event.key;
            }

            // Check for Enter key (end of barcode scan)
            if (event.key === 'Enter' && barcodeBuffer.length > 20) {
                event.preventDefault();

                // Try to process as ID barcode
                if (handleIdBarcodeScan(barcodeBuffer)) {
                    barcodeBuffer = '';
                    return;
                }

                barcodeBuffer = '';
            }

            // Clear buffer if it gets too long
            if (barcodeBuffer.length > 1000) {
                barcodeBuffer = '';
            }
        });
    }

    /**
     * Check if product requires ID verification
     */
    function requiresIdCheck(product) {
        if (!product) return false;

        // Check product group/category
        const productGroup = product.group || product.category || product.productGroup || '';
        const productGroupName = typeof productGroup === 'object' ?
            (productGroup.name || productGroup.title || '') :
            productGroup.toString();

        // Check if product group matches any age-restricted groups
        const requiresId = AGE_RESTRICTED_GROUPS.some(restrictedGroup =>
            productGroupName.toLowerCase().includes(restrictedGroup.toLowerCase()) ||
            restrictedGroup.toLowerCase().includes(productGroupName.toLowerCase())
        );

        // Additional checks for product name/description if group info not available
        if (!requiresId && (product.name || product.description)) {
            const productText = ((product.name || '') + ' ' + (product.description || '')).toLowerCase();
            return AGE_RESTRICTED_GROUPS.some(group =>
                productText.includes(group.toLowerCase().replace(/[/\s]+/g, ''))
            );
        }

        return requiresId;
    }

    /**
     * Show ID check notification
     */
    function showIdCheckNotification(product) {
        // Only show once per transaction
        if (idCheckShownForTransaction) {
            console.log('ID check already shown for this transaction');
            return;
        }

        console.log('Showing ID check notification for:', product.name || product.code);

        // Mark as shown for this transaction
        idCheckShownForTransaction = true;

        // Show ID scanner interface
        showIdScanner();

        // Log for audit purposes
        logIdCheckEvent(product);
    }

    /**
     * Handle transaction start
     */
    function handleTransactionStart(transaction) {
        console.log('New transaction started:', transaction);
        resetForNewTransaction(transaction.id);
    }

    /**
     * Reset for new transaction
     */
    function resetForNewTransaction(transactionId) {
        console.log('Resetting for new transaction:', transactionId);
        idCheckShownForTransaction = false;
        ageVerifiedForTransaction = false;
        currentTransactionId = transactionId;
        scannedCustomerInfo = null;
    }

    /**
     * Log ID check event for audit purposes
     */
    function logIdCheckEvent(product) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            transactionId: currentTransactionId,
            productCode: product.code || product.id,
            productName: product.name,
            productGroup: product.group || product.category,
            action: 'ID_CHECK_PROMPTED'
        };

        console.log('ID Check Log:', logEntry);

        // Store in session storage for reporting (in-memory alternative)
        try {
            if (typeof window !== 'undefined' && window.sessionStorage) {
                const existingLogs = JSON.parse(sessionStorage.getItem('idCheckLogs') || '[]');
                existingLogs.push(logEntry);
                sessionStorage.setItem('idCheckLogs', JSON.stringify(existingLogs));
            }
        } catch (e) {
            console.log('Could not store log entry:', e);
        }
    }

    /**
     * Log age verification event
     */
    function logAgeVerificationEvent(idData, age, approved) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            transactionId: currentTransactionId,
            customerAge: age,
            customerName: (idData.firstName || '') + ' ' + (idData.lastName || idData.fullName || ''),
            birthDate: idData.dateOfBirth ? idData.dateOfBirth.toISOString() : null,
            approved: approved,
            minimumAge: MINIMUM_AGE,
            action: approved ? 'AGE_VERIFIED_APPROVED' : 'AGE_VERIFIED_DENIED'
        };

        console.log('Age Verification Log:', logEntry);

        // Store in session storage for reporting
        try {
            if (typeof window !== 'undefined' && window.sessionStorage) {
                const existingLogs = JSON.parse(sessionStorage.getItem('ageVerificationLogs') || '[]');
                existingLogs.push(logEntry);
                sessionStorage.setItem('ageVerificationLogs', JSON.stringify(existingLogs));
            }
        } catch (e) {
            console.log('Could not store verification log:', e);
        }
    }

    /**
     * Play alert sound
     */
    function playAlertSound() {
        try {
            // Create a more noticeable alert sound for age verification failures
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(400, audioContext.currentTime + 0.2);
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime + 0.4);

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.6);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.6);
        } catch (e) {
            console.log('Could not play alert sound:', e);
        }
    }

    /**
     * Approve manual verification
     */
    function approveManualVerification() {
        document.getElementById('manual-age-verification')?.remove();
        ageVerifiedForTransaction = true;

        // Log manual verification
        const logEntry = {
            timestamp: new Date().toISOString(),
            transactionId: currentTransactionId,
            verificationType: 'MANUAL',
            approved: true,
            action: 'MANUAL_AGE_VERIFICATION_APPROVED'
        };

        console.log('Manual Verification Log:', logEntry);

        // Show success message
        showManualVerificationSuccess();
    }

    /**
     * Deny manual verification
     */
    function denyManualVerification() {
        document.getElementById('manual-age-verification')?.remove();

        // Log manual verification denial
        const logEntry = {
            timestamp: new Date().toISOString(),
            transactionId: currentTransactionId,
            verificationType: 'MANUAL',
            approved: false,
            action: 'MANUAL_AGE_VERIFICATION_DENIED'
        };

        console.log('Manual Verification Denial Log:', logEntry);

        // Show denial message
        showManualVerificationDenial();
    }

    /**
     * Show manual verification success
     */
    function showManualVerificationSuccess() {
        const modal = document.createElement('div');
        modal.id = 'manual-verification-success';
        modal.innerHTML = `
            <div style="
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.8);
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: Arial, sans-serif;
            ">
                <div style="
                    background: #fff;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                    text-align: center;
                    max-width: 500px;
                    border: 3px solid #28a745;
                ">
                    <div style="
                        font-size: 48px;
                        color: #28a745;
                        margin-bottom: 20px;
                    ">✅</div>
                    <h2 style="
                        color: #28a745;
                        margin: 0 0 15px 0;
                        font-size: 24px;
                        font-weight: bold;
                    ">MANUAL VERIFICATION COMPLETE</h2>
                    <p style="
                        font-size: 18px;
                        margin: 15px 0;
                        color: #333;
                        font-weight: bold;
                    ">Customer age manually verified - Sale approved</p>
                    <button onclick="document.getElementById('manual-verification-success').remove()" style="
                        background: #28a745;
                        color: white;
                        border: none;
                        padding: 15px 30px;
                        font-size: 16px;
                        font-weight: bold;
                        border-radius: 5px;
                        cursor: pointer;
                        margin-top: 20px;
                    ">CONTINUE SALE</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            if (document.getElementById('manual-verification-success')) {
                document.getElementById('manual-verification-success').remove();
            }
        }, 5000);
    }

    /**
     * Show manual verification denial
     */
    function showManualVerificationDenial() {
        const modal = document.createElement('div');
        modal.id = 'manual-verification-denial';
        modal.innerHTML = `
            <div style="
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.9);
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: Arial, sans-serif;
            ">
                <div style="
                    background: #fff;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                    text-align: center;
                    max-width: 500px;
                    border: 3px solid #dc3545;
                ">
                    <div style="
                        font-size: 48px;
                        color: #dc3545;
                        margin-bottom: 20px;
                    ">🚫</div>
                    <h2 style="
                        color: #dc3545;
                        margin: 0 0 15px 0;
                        font-size: 24px;
                        font-weight: bold;
                    ">SALE DENIED - MANUAL VERIFICATION</h2>
                    <p style="
                        font-size: 18px;
                        margin: 15px 0;
                        color: #333;
                        font-weight: bold;
                    ">Customer verified as under 21 years old</p>
                    <div style="
                        background: #f8d7da;
                        border: 1px solid #f5c6cb;
                        color: #721c24;
                        padding: 15px;
                        border-radius: 5px;
                        margin: 20px 0;
                        font-weight: bold;
                    ">
                        REMOVE ALL AGE-RESTRICTED ITEMS FROM TRANSACTION
                    </div>
                    <button onclick="document.getElementById('manual-verification-denial').remove()" style="
                        background: #dc3545;
                        color: white;
                        border: none;
                        padding: 15px 30px;
                        font-size: 16px;
                        font-weight: bold;
                        border-radius: 5px;
                        cursor: pointer;
                        margin-top: 10px;
                    ">ACKNOWLEDGE</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        playAlertSound();
    }

    /**
     * Setup DOM observer for product additions
     */
    function setupDOMObserver() {
        if (typeof MutationObserver === 'undefined') return;

        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList') {
                    // Look for new product rows or items added to transaction
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            checkElementForProducts(node);
                        }
                    });
                }
            });
        });

        // Start observing
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Check DOM element for product information
     */
    function checkElementForProducts(element) {
        // Look for product information in common ERPLY POS element patterns
        const productElements = element.querySelectorAll('[data-product], [data-item], .product-row, .item-row');

        productElements.forEach(el => {
            const productData = extractProductDataFromElement(el);
            if (productData && requiresIdCheck(productData)) {
                if (!ageVerifiedForTransaction) {
                    showIdCheckNotification(productData);
                }
            }
        });
    }

    /**
     * Extract product data from DOM element
     */
    function extractProductDataFromElement(element) {
        try {
            // Try to extract product data from various attributes and text content
            const productData = {
                code: element.getAttribute('data-product-code') || element.getAttribute('data-code'),
                name: element.getAttribute('data-product-name') || element.getAttribute('data-name'),
                group: element.getAttribute('data-product-group') || element.getAttribute('data-group'),
                category: element.getAttribute('data-category')
            };

            // If no attributes, try to parse from text content
            if (!productData.name && !productData.code) {
                const textContent = element.textContent || '';
                const lines = textContent.split('\n').map(l => l.trim()).filter(l => l);
                if (lines.length > 0) {
                    productData.name = lines[0];
                }
            }

            return productData;
        } catch (e) {
            return null;
        }
    }

    /**
     * Setup transaction monitor (polling fallback)
     */
    function setupTransactionMonitor() {
        let lastItemCount = 0;

        setInterval(() => {
            try {
                // Try to get current transaction item count
                let currentItemCount = 0;

                // Method 1: Check ERPLY transaction object
                if (typeof ERPLY !== 'undefined' && ERPLY.POS && ERPLY.POS.currentTransaction) {
                    currentItemCount = ERPLY.POS.currentTransaction.items ? ERPLY.POS.currentTransaction.items.length : 0;
                }

                // Method 2: Count DOM elements
                if (currentItemCount === 0) {
                    const itemElements = document.querySelectorAll('.transaction-item, .pos-item, [data-item]');
                    currentItemCount = itemElements.length;
                }

                // If item count increased, check the new items
                if (currentItemCount > lastItemCount) {
                    console.log('New items detected, checking for age restrictions');
                    checkRecentItems();
                }

                lastItemCount = currentItemCount;

                // Reset if item count drops to 0 (new transaction)
                if (currentItemCount === 0 && lastItemCount > 0) {
                    resetForNewTransaction(Date.now().toString());
                }

            } catch (e) {
                console.log('Transaction monitor error:', e);
            }
        }, 1000); // Check every second
    }

    /**
     * Check recently added items
     */
    function checkRecentItems() {
        // Get all current transaction items
        const itemElements = document.querySelectorAll('.transaction-item, .pos-item, [data-item]');

        // Check the most recent items
        for (let i = Math.max(0, itemElements.length - 3); i < itemElements.length; i++) {
            const element = itemElements[i];
            const productData = extractProductDataFromElement(element);

            if (productData && requiresIdCheck(productData)) {
                if (!ageVerifiedForTransaction) {
                    showIdCheckNotification(productData);
                    break; // Only show once per transaction
                }
            }
        }
    }

    // Initialize the system when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeIdCheckSystem);
    } else {
        initializeIdCheckSystem();
    }

    // Also initialize after a short delay to ensure ERPLY is loaded
    setTimeout(initializeIdCheckSystem, 2000);

    // Export for manual testing and integration
    window.ERPLYIdCheck = {
        requiresIdCheck: requiresIdCheck,
        showNotification: showIdCheckNotification,
        showIdScanner: showIdScanner,
        manualAgeVerification: showManualAgeVerification,
        approveManualVerification: approveManualVerification,
        denyManualVerification: denyManualVerification,
        reset: () => resetForNewTransaction(Date.now().toString()),
        parseIdBarcode: parseIdBarcode,
        verifyAge: verifyCustomerAge,
        getScannedCustomerInfo: () => scannedCustomerInfo,
        getVerificationStatus: () => ({
            idCheckShown: idCheckShownForTransaction,
            ageVerified: ageVerifiedForTransaction,
            transactionId: currentTransactionId
        }),
        test: (productName, productGroup) => {
            showIdCheckNotification({
                name: productName,
                group: productGroup,
                code: 'TEST-' + Date.now()
            });
        },
        testIdScan: (idBarcode) => {
            handleIdBarcodeScan(idBarcode);
        }
    };



    // Hook into product scan (pseudo-code, assumes some product scan event/callback exists)
    function onProductScanned(product) {
        const groupName = product.groupName || product.group; // Adjust based on actual product object

        if (AGE_RESTRICTED_GROUPS.includes(groupName)) {
            if (!idCheckShownForTransaction && !ageVerifiedForTransaction) {
                showIDScanPrompt(); // Function to display ID scan prompt
                idCheckShownForTransaction = true;
            }
        }
    }

    // Replace or hook this into the actual product scan mechanism of Erply POS
    // For example: POS.on('productScanned', onProductScanned);

})();