'use strict';

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function computeMonthlyRepayment(principal, annualRate, years) {
  const p = Math.max(0, safeNumber(principal));
  const termYears = Math.max(0, safeNumber(years));
  const rate = Math.max(0, safeNumber(annualRate));
  if (p <= 0 || termYears <= 0) return 0;
  const months = termYears * 12;
  const monthlyRate = rate / 12 / 100;
  if (monthlyRate <= 0) return p / months;
  const compound = Math.pow(1 + monthlyRate, months);
  return (p * monthlyRate * compound) / (compound - 1);
}

function buildMortgageEstimate(input = {}) {
  const purchasePrice = Math.max(0, safeNumber(input.purchasePrice));
  const depositAmount = input.depositAmount != null
    ? Math.max(0, safeNumber(input.depositAmount))
    : purchasePrice * (Math.min(100, Math.max(0, safeNumber(input.depositPercent, 20))) / 100);
  const loanAmount = Math.max(0, purchasePrice - depositAmount);
  const annualRate = Math.max(0, safeNumber(input.annualRate, 16));
  const termYears = Math.max(1, safeNumber(input.termYears, 20));
  const monthlyRepayment = computeMonthlyRepayment(loanAmount, annualRate, termYears);
  const bankRegistrationEstimate = loanAmount * 0.015;
  const transferEstimate = purchasePrice * 0.01;
  const onceOffCosts = depositAmount + bankRegistrationEstimate + transferEstimate;
  const incomeRequired = monthlyRepayment / 0.35;
  const totalInterestEstimate = Math.max(0, monthlyRepayment * termYears * 12 - loanAmount);
  return {
    purchasePrice,
    depositAmount,
    loanAmount,
    annualRate,
    termYears,
    monthlyRepayment,
    bankRegistrationEstimate,
    transferEstimate,
    onceOffCosts,
    incomeRequired,
    totalInterestEstimate
  };
}

module.exports = {
  buildMortgageEstimate,
  computeMonthlyRepayment
};
