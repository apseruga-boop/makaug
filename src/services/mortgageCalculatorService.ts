import type { MortgageEstimate } from '../types/domain';

export class MortgageCalculatorService {
  estimate(input: {
    propertyPrice: number;
    depositPercent: number;
    termYears: number;
    annualInterestRate?: number;
    householdIncome?: number;
  }): MortgageEstimate {
    const annualRate = input.annualInterestRate ?? 0.17;
    const monthlyRate = annualRate / 12;
    const months = Math.max(1, Math.round(input.termYears * 12));
    const depositAmount = input.propertyPrice * (input.depositPercent / 100);
    const loanAmount = Math.max(0, input.propertyPrice - depositAmount);

    const monthlyRepayment =
      monthlyRate === 0
        ? loanAmount / months
        : (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);

    const income = input.householdIncome ?? 0;
    const debtRatio = income > 0 ? (monthlyRepayment / income) * 100 : 0;

    const affordabilityNote =
      income <= 0
        ? 'Share your household income for a stronger affordability check.'
        : debtRatio <= 35
          ? 'Estimated repayment appears affordable for many households.'
          : debtRatio <= 50
            ? 'Repayment may be possible but could be tight. Consider a larger deposit or longer term.'
            : 'Repayment appears high relative to income. Consider a lower budget or larger deposit.';

    return {
      monthlyRepayment,
      depositAmount,
      loanAmount,
      affordabilityNote,
      disclaimer:
        'Rates are indicative and may change by bank, profile, and product. Confirm final terms with the lender.'
    };
  }
}
