import fs from 'node:fs';
import path from 'node:path';

export interface FrameworkInfo {
  language: string;
  framework: string;
  package_manager?: string;
  install_command?: string;
  test_command?: string;
  targeted_test_command?: string;
  service_name?: string;
}

export function detectFramework(rootDir: string): FrameworkInfo {
  const pkgPath = path.join(rootDir, 'package.json');
  const reqPath = path.join(rootDir, 'requirements.txt');
  const pyProject = path.join(rootDir, 'pyproject.toml');
  const goMod = path.join(rootDir, 'go.mod');
  const cargoToml = path.join(rootDir, 'Cargo.toml');
  const pomXml = path.join(rootDir, 'pom.xml');
  const gradle = path.join(rootDir, 'build.gradle');
  const gradleKts = path.join(rootDir, 'build.gradle.kts');

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
      const deps = {
        ...((pkg.dependencies as Record<string, string>) ?? {}),
        ...((pkg.devDependencies as Record<string, string>) ?? {}),
      };
      const isTs = !!deps.typescript || fs.existsSync(path.join(rootDir, 'tsconfig.json'));
      let framework = 'node';
      if (deps['@nestjs/core']) framework = 'nestjs';
      else if (deps['fastify']) framework = 'fastify';
      else if (deps['express']) framework = 'express';
      else if (deps['koa']) framework = 'koa';
      else if (deps['hapi'] || deps['@hapi/hapi']) framework = 'hapi';
      else if (deps['next']) framework = 'nextjs';
      const pm = fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml'))
        ? 'pnpm'
        : fs.existsSync(path.join(rootDir, 'yarn.lock'))
        ? 'yarn'
        : 'npm';
      const installCommand = pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : pm === 'yarn' ? 'yarn install --frozen-lockfile' : 'npm ci';
      const testCommand = ((pkg.scripts as Record<string, string>) ?? {}).test
        ? `${pm} test`
        : `${pm} test`;
      return {
        language: isTs ? 'typescript' : 'javascript',
        framework,
        package_manager: pm,
        install_command: installCommand,
        test_command: testCommand,
        targeted_test_command: `${pm} test -- {test_file}`,
        service_name: typeof pkg.name === 'string' ? pkg.name : undefined,
      };
    } catch {
      return { language: 'javascript', framework: 'node' };
    }
  }

  if (fs.existsSync(pyProject) || fs.existsSync(reqPath)) {
    let framework = 'python';
    try {
      const haystack = [reqPath, pyProject]
        .filter((f) => fs.existsSync(f))
        .map((f) => fs.readFileSync(f, 'utf8'))
        .join('\n')
        .toLowerCase();
      if (haystack.includes('fastapi')) framework = 'fastapi';
      else if (haystack.includes('django')) framework = 'django';
      else if (haystack.includes('flask')) framework = 'flask';
    } catch {
      // ignore
    }
    return {
      language: 'python',
      framework,
      package_manager: 'pip',
      install_command: 'pip install -r requirements.txt',
      test_command: 'pytest',
      targeted_test_command: 'pytest {test_file}',
    };
  }

  if (fs.existsSync(goMod)) {
    return {
      language: 'go',
      framework: 'go',
      install_command: 'go mod download',
      test_command: 'go test ./...',
      targeted_test_command: 'go test {test_file}',
    };
  }

  if (fs.existsSync(cargoToml)) {
    return {
      language: 'rust',
      framework: 'rust',
      install_command: 'cargo fetch',
      test_command: 'cargo test',
    };
  }

  if (fs.existsSync(pomXml) || fs.existsSync(gradle) || fs.existsSync(gradleKts)) {
    return {
      language: 'java',
      framework: 'spring',
      install_command: fs.existsSync(pomXml) ? 'mvn -B install -DskipTests' : './gradlew build -x test',
      test_command: fs.existsSync(pomXml) ? 'mvn test' : './gradlew test',
    };
  }

  return { language: 'unknown', framework: 'unknown' };
}
