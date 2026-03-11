const ToyPadCliApp = require('./src/app/ToyPadCliApp');

async function bootstrap() {
  const app = new ToyPadCliApp();
  await app.start();
}

bootstrap();
