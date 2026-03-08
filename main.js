const fs = require('fs');

function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    timeStr = timeStr.trim().toLowerCase();
    let isPM = timeStr.includes('pm');
    let isAM = timeStr.includes('am');
    timeStr = timeStr.replace('am', '').replace('pm', '').trim();
    
    let parts = timeStr.split(':');
    let hours = parseInt(parts[0], 10);
    let mins = parseInt(parts[1], 10);
    let secs = parseInt(parts[2], 10);

    if (isPM && hours !== 12) hours += 12;
    if (isAM && hours === 12) hours = 0;

    return hours * 3600 + mins * 60 + secs;
}

function secondsToTime(totalSeconds) {
    let isNegative = totalSeconds < 0;
    totalSeconds = Math.abs(totalSeconds);
    
    let hours = Math.floor(totalSeconds / 3600);
    let mins = Math.floor((totalSeconds % 3600) / 60);
    let secs = totalSeconds % 60;

    let minsStr = mins < 10 ? '0' + mins : mins;
    let secsStr = secs < 10 ? '0' + secs : secs;

    let result = `${hours}:${minsStr}:${secsStr}`;
    return isNegative ? "-" + result : result;
}

function getShiftDuration(startTime, endTime) {
    let startSecs = timeToSeconds(startTime);
    let endSecs = timeToSeconds(endTime);
    let diff = endSecs - startSecs;
    
    if (diff < 0) {
        diff += 24 * 3600; 
    }
    
    return secondsToTime(diff);
}

function getIdleTime(startTime, endTime) {
    let startSecs = timeToSeconds(startTime);
    let endSecs = timeToSeconds(endTime);
    
    if (endSecs < startSecs) endSecs += 24 * 3600;

    let deliveryStart = 8 * 3600;
    let deliveryEnd = 22 * 3600;
    let idleSecs = 0;

    if (startSecs < deliveryStart) {
        let endOfEarlyIdle = Math.min(endSecs, deliveryStart);
        if (endOfEarlyIdle > startSecs) {
            idleSecs += (endOfEarlyIdle - startSecs);
        }
    }

    if (endSecs > deliveryEnd) {
        let startOfLateIdle = Math.max(startSecs, deliveryEnd);
        if (endSecs > startOfLateIdle) {
            idleSecs += (endSecs - startOfLateIdle);
        }
    }

    return secondsToTime(idleSecs);
}

function getActiveTime(shiftDuration, idleTime) {
    let totalSecs = timeToSeconds(shiftDuration);
    let idleSecs = timeToSeconds(idleTime);
    return secondsToTime(totalSecs - idleSecs);
}

function metQuota(date, activeTime) {
    let activeSecs = timeToSeconds(activeTime);
    let normalQuota = (8 * 3600) + (24 * 60);
    let eidQuota = 6 * 3600;
    
    let parts = date.split('-');
    let year = parseInt(parts[0], 10);
    let month = parseInt(parts[1], 10);
    let day = parseInt(parts[2], 10);

    let target = normalQuota;
    
    if (year === 2025 && month === 4 && day >= 10 && day <= 30) {
        target = eidQuota;
    }

    return activeSecs >= target;
}

function addShiftRecord(textFile, shiftObj) {
    let lines = [];
    if (fs.existsSync(textFile)) {
        let content = fs.readFileSync(textFile, 'utf8');
        lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
    }

    let driverLastIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        let parts = lines[i].split(',');
        if (parts[0].trim() === shiftObj.driverID) {
            driverLastIndex = i; 
            if (parts[2].trim() === shiftObj.date) {
                return {};
            }
        }
    }

    let duration = getShiftDuration(shiftObj.startTime, shiftObj.endTime);
    let idle = getIdleTime(shiftObj.startTime, shiftObj.endTime);
    let active = getActiveTime(duration, idle);
    let quota = metQuota(shiftObj.date, active);

    let newEntry = {
        driverID: shiftObj.driverID,
        driverName: shiftObj.driverName,
        date: shiftObj.date,
        startTime: shiftObj.startTime,
        endTime: shiftObj.endTime,
        shiftDuration: duration,
        idleTime: idle,
        activeTime: active,
        metQuota: quota,
        hasBonus: false
    };

    let newRow = `${newEntry.driverID},${newEntry.driverName},${newEntry.date},${newEntry.startTime},${newEntry.endTime},${newEntry.shiftDuration},${newEntry.idleTime},${newEntry.activeTime},${newEntry.metQuota},${newEntry.hasBonus}`;

    if (driverLastIndex !== -1) {
        lines.splice(driverLastIndex + 1, 0, newRow);
    } else {
        lines.push(newRow);
    }

    fs.writeFileSync(textFile, lines.join('\n'));
    return newEntry;
}

function setBonus(textFile, driverID, date, newValue) {
    if (!fs.existsSync(textFile)) return;
    
    let lines = fs.readFileSync(textFile, 'utf8').split(/\r?\n/);
    let fileUpdated = false;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '') continue;
        
        let parts = lines[i].split(',');
        if (parts[0].trim() === driverID && parts[2].trim() === date) {
            parts[9] = newValue.toString();
            lines[i] = parts.join(',');
            fileUpdated = true;
            break;
        }
    }

    if (fileUpdated) {
        fs.writeFileSync(textFile, lines.join('\n'));
    }
}

function countBonusPerMonth(textFile, driverID, month) {
    if (!fs.existsSync(textFile)) return -1;
    
    let lines = fs.readFileSync(textFile, 'utf8').split(/\r?\n/);
    let bonusCount = 0;
    let foundDriver = false;
    let targetMonth = parseInt(month, 10);

    for (let line of lines) {
        if (line.trim() === '') continue;
        
        let parts = line.split(',');
        if (parts[0].trim() === driverID) {
            foundDriver = true;
            let recordMonth = parseInt(parts[2].trim().split('-')[1], 10);
            
            if (recordMonth === targetMonth && parts[9].trim() === 'true') {
                bonusCount++;
            }
        }
    }

    return foundDriver ? bonusCount : -1;
}

function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    if (!fs.existsSync(textFile)) return "0:00:00";
    
    let lines = fs.readFileSync(textFile, 'utf8').split(/\r?\n/);
    let totalSecs = 0;
    let targetMonth = parseInt(month, 10);

    for (let line of lines) {
        if (line.trim() === '') continue;
        
        let parts = line.split(',');
        if (parts[0].trim() === driverID) {
            let recordMonth = parseInt(parts[2].trim().split('-')[1], 10);
            if (recordMonth === targetMonth) {
                totalSecs += timeToSeconds(parts[7].trim());
            }
        }
    }
    
    return secondsToTime(totalSecs);
}

function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    if (!fs.existsSync(rateFile) || !fs.existsSync(textFile)) return "0:00:00";

    let rateLines = fs.readFileSync(rateFile, 'utf8').split(/\r?\n/);
    let dayOff = "";
    for (let line of rateLines) {
        if (line.trim() === '') continue;
        let parts = line.split(',');
        if (parts[0].trim() === driverID) {
            dayOff = parts[1].trim();
            break;
        }
    }

    let textLines = fs.readFileSync(textFile, 'utf8').split(/\r?\n/);
    let targetMonth = parseInt(month, 10);
    let requiredSecs = 0;
    const daysArr = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    for (let line of textLines) {
        if (line.trim() === '') continue;
        
        let parts = line.split(',');
        if (parts[0].trim() === driverID) {
            let dateStr = parts[2].trim();
            let [y, m, d] = dateStr.split('-');
            let year = parseInt(y, 10);
            let monthInt = parseInt(m, 10);
            let day = parseInt(d, 10);

            if (monthInt === targetMonth) {
                let dateObj = new Date(year, monthInt - 1, day);
                let dayName = daysArr[dateObj.getDay()];

                if (dayName !== dayOff) {
                    if (year === 2025 && monthInt === 4 && day >= 10 && day <= 30) {
                        requiredSecs += 6 * 3600;
                    } else {
                        requiredSecs += (8 * 3600 + 24 * 60);
                    }
                }
            }
        }
    }

    requiredSecs -= (bonusCount * 2 * 3600);
    if (requiredSecs < 0) requiredSecs = 0;

    return secondsToTime(requiredSecs);
}

function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    if (!fs.existsSync(rateFile)) return 0;

    let rateLines = fs.readFileSync(rateFile, 'utf8').split(/\r?\n/);
    let basePay = 0;
    let tier = 0;

    for (let line of rateLines) {
        if (line.trim() === '') continue;
        let parts = line.split(',');
        if (parts[0].trim() === driverID) {
            basePay = parseInt(parts[2].trim(), 10);
            tier = parseInt(parts[3].trim(), 10);
            break;
        }
    }

    let actualSecs = timeToSeconds(actualHours);
    let requiredSecs = timeToSeconds(requiredHours);

    if (actualSecs >= requiredSecs) {
        return basePay;
    }

    let missingSecs = requiredSecs - actualSecs;
    
    let allowedMissing = 0;
    if (tier === 1) allowedMissing = 50;
    else if (tier === 2) allowedMissing = 20;
    else if (tier === 3) allowedMissing = 10;
    else if (tier === 4) allowedMissing = 3;

    let missingHoursExact = missingSecs / 3600;
    let billableMissingExact = missingHoursExact - allowedMissing;

    if (billableMissingExact <= 0) {
        return basePay;
    }

    let billableMissing = Math.floor(billableMissingExact);
    let deductionRatePerHour = Math.floor(basePay / 185);
    
    let salaryDeduction = billableMissing * deductionRatePerHour;

    return basePay - salaryDeduction;
}

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};
