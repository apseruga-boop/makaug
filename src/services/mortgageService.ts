import { repositories } from '../repositories';
import { MortgageCalculatorService } from './mortgageCalculatorService';

export class MortgageService {
  constructor(private readonly calculator = new MortgageCalculatorService()) {}

  async estimateAndStore(payload: {
    userPhone: string;
    propertyPrice: number;
    propertyPurpose: string;
    depositPercent: number;
    termYears: number;
    householdIncome?: number;
  }) {
    const estimate = this.calculator.estimate({
      propertyPrice: payload.propertyPrice,
      depositPercent: payload.depositPercent,
      termYears: payload.termYears,
      householdIncome: payload.householdIncome
    });

    const enquiryId = await repositories.mortgage.create({
      ...payload,
      estimate
    });

    return { enquiryId, estimate };
  }
}
