"use strict";
// We use this for base 36 maths
import { BN } from "bn.js";
import { arrayify, hexDataSlice, isHexString, stripZeros } from "@ethersproject/bytes";
import { keccak256 } from "@ethersproject/keccak256";
import { encode } from "@ethersproject/rlp";
import { Logger } from "@ethersproject/logger";
import { version } from "./_version";
const logger = new Logger(version);
function getChecksumAddress(address) {
    if (!isHexString(address, 20)) {
        logger.throwArgumentError("invalid address", "address", address);
    }
    address = address.toLowerCase();
    let chars = address.substring(2).split("");
    let hashed = new Uint8Array(40);
    for (let i = 0; i < 40; i++) {
        hashed[i] = chars[i].charCodeAt(0);
    }
    hashed = arrayify(keccak256(hashed));
    for (let i = 0; i < 40; i += 2) {
        if ((hashed[i >> 1] >> 4) >= 8) {
            chars[i] = chars[i].toUpperCase();
        }
        if ((hashed[i >> 1] & 0x0f) >= 8) {
            chars[i + 1] = chars[i + 1].toUpperCase();
        }
    }
    return "0x" + chars.join("");
}
// Shims for environments that are missing some required constants and functions
const MAX_SAFE_INTEGER = 0x1fffffffffffff;
function log10(x) {
    if (Math.log10) {
        return Math.log10(x);
    }
    return Math.log(x) / Math.LN10;
}
// See: https://en.wikipedia.org/wiki/International_Bank_Account_Number
// Create lookup table
let ibanLookup = {};
for (let i = 0; i < 10; i++) {
    ibanLookup[String(i)] = String(i);
}
for (let i = 0; i < 26; i++) {
    ibanLookup[String.fromCharCode(65 + i)] = String(10 + i);
}
// How many decimal digits can we process? (for 64-bit float, this is 15)
let safeDigits = Math.floor(log10(MAX_SAFE_INTEGER));
function ibanChecksum(address) {
    address = address.toUpperCase();
    address = address.substring(4) + address.substring(0, 2) + "00";
    let expanded = "";
    address.split("").forEach(function (c) {
        expanded += ibanLookup[c];
    });
    // Javascript can handle integers safely up to 15 (decimal) digits
    while (expanded.length >= safeDigits) {
        let block = expanded.substring(0, safeDigits);
        expanded = parseInt(block, 10) % 97 + expanded.substring(block.length);
    }
    let checksum = String(98 - (parseInt(expanded, 10) % 97));
    while (checksum.length < 2) {
        checksum = "0" + checksum;
    }
    return checksum;
}
;
export function getAddress(address) {
    let result = null;
    if (typeof (address) !== "string") {
        logger.throwArgumentError("invalid address", "address", address);
    }
    if (address.match(/^(0x)?[0-9a-fA-F]{40}$/)) {
        // Missing the 0x prefix
        if (address.substring(0, 2) !== "0x") {
            address = "0x" + address;
        }
        result = getChecksumAddress(address);
        // It is a checksummed address with a bad checksum
        if (address.match(/([A-F].*[a-f])|([a-f].*[A-F])/) && result !== address) {
            logger.throwArgumentError("bad address checksum", "address", address);
        }
        // Maybe ICAP? (we only support direct mode)
    }
    else if (address.match(/^XE[0-9]{2}[0-9A-Za-z]{30,31}$/)) {
        // It is an ICAP address with a bad checksum
        if (address.substring(2, 4) !== ibanChecksum(address)) {
            logger.throwArgumentError("bad icap checksum", "address", address);
        }
        result = (new BN(address.substring(4), 36)).toString(16);
        while (result.length < 40) {
            result = "0" + result;
        }
        result = getChecksumAddress("0x" + result);
    }
    else {
        logger.throwArgumentError("invalid address", "address", address);
    }
    return result;
}
export function isAddress(address) {
    try {
        getAddress(address);
        return true;
    }
    catch (error) { }
    return false;
}
export function getIcapAddress(address) {
    let base36 = (new BN(getAddress(address).substring(2), 16)).toString(36).toUpperCase();
    while (base36.length < 30) {
        base36 = "0" + base36;
    }
    return "XE" + ibanChecksum("XE00" + base36) + base36;
}
// http://ethereum.stackexchange.com/questions/760/how-is-the-address-of-an-ethereum-contract-computed
export function getContractAddress(transaction) {
    let from = null;
    try {
        from = getAddress(transaction.from);
    }
    catch (error) {
        logger.throwArgumentError("missing from address", "transaction", transaction);
    }
    let nonce = stripZeros(arrayify(transaction.nonce, {allowOddLength: true}));
    return getAddress(hexDataSlice(keccak256(encode([from, nonce])), 12));
}
