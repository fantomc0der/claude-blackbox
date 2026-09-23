export function withSelectedOption(values: string[], selected: string): string[] {
  return selected && !values.includes(selected) ? [selected, ...values] : values;
}
