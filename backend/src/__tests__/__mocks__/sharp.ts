const sharp = () => ({
  resize: () => sharp(),
  toFormat: () => sharp(),
  toBuffer: async () => Buffer.from(''),
  toFile: async () => ({}),
});

export default sharp;
