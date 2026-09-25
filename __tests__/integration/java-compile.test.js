import path from 'path'
import fs from 'fs'
import os from 'os'
import {execFileSync} from 'child_process'
import JavaAppiumScriptGenerator from '../../src/services/java'
import {removeDir} from '../../src/utils/fs-wrapper'
import {getMavenJavaVersion, hasJavaToolchain, MIN_JAVA_VERSION} from '../helpers/java-toolchain'

const FIXTURES = [
  'java-junit-input.json',
  'java-testng-input.json',
  'java-testng-coverage-input.json'
]
const REMOVED_APIS =
  /MobileElement|MobileBy|MobileCapabilityType|org\.openqa\.selenium\.html5|\bundefined\b/
const REQUIRED = process.env.REQUIRE_JAVA_COMPILE === 'true'
const SESSION_CHECK_SOURCE =
  path.resolve(__dirname, '../resource/java/SessionCapabilitiesCheck.java')
const SOURCE_PACKAGE_DIR = ['src', 'test', 'java', 'com', 'kobiton', 'scriptlessautomation']
const TOOLCHAIN_READY = hasJavaToolchain()

if (!TOOLCHAIN_READY && !REQUIRED) {
  console.warn(`Skipping Java compile tests: mvn running on JDK ${MIN_JAVA_VERSION}+ not found ` +
    `(found: ${getMavenJavaVersion() || 'none'})`)
}

const listFiles = (dir) => fs.readdirSync(dir, {withFileTypes: true})
  .flatMap((entry) => {
    const entryPath = path.join(dir, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  })

const findProjectDir = (dir) => path.dirname(
  listFiles(dir).find((file) => path.basename(file) === 'pom.xml')
)

describe('JavaAppiumScriptGenerator compiled output', () => {
  const describeCompile = TOOLCHAIN_READY || REQUIRED ? describe : describe.skip

  describeCompile.each(FIXTURES)('%s', (fixture) => {
    let workingDir, projectDir

    beforeAll(async () => {
      if (!TOOLCHAIN_READY) {
        throw new Error('REQUIRE_JAVA_COMPILE is set but mvn running on ' +
          `JDK ${MIN_JAVA_VERSION}+ was not found`)
      }

      const fixturePath = path.resolve(__dirname, '../resource', fixture)
      const input = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))
      const fixtureName = path.basename(fixture, '.json')
      workingDir = path.join(os.tmpdir(), `java-compile-test-${fixtureName}-${Date.now()}`)
      const {outputFile} = await new JavaAppiumScriptGenerator({}).run({...input, workingDir})

      const extractDir = path.join(workingDir, 'extracted')
      fs.mkdirSync(extractDir, {recursive: true})
      execFileSync('unzip', ['-q', outputFile, '-d', extractDir])
      projectDir = findProjectDir(extractDir)
    })

    afterAll(async () => {
      if (workingDir) await removeDir(workingDir)
    })

    it('targets the current Java, Appium and Selenium generation', () => {
      const pom = fs.readFileSync(path.join(projectDir, 'pom.xml'), 'utf-8')

      expect(pom).toContain('<maven.compiler.release>17</maven.compiler.release>')
      expect(pom).toMatch(/<artifactId>java-client<\/artifactId>\s*<version>10\./)
      expect(pom).toContain('<artifactId>selenium-bom</artifactId>')
      expect(pom).not.toMatch(/reportng|dom4j|jaxen|<artifactId>selenium-java<\/artifactId>/)
    })

    it('uses no APIs removed from java-client 8+ or Selenium 4', () => {
      const offenders = listFiles(projectDir)
        .filter((file) => file.endsWith('.java'))
        .filter((file) => REMOVED_APIS.test(fs.readFileSync(file, 'utf-8')))
        .map((file) => path.relative(projectDir, file))

      expect(offenders).toEqual([])
    })

    it('compiles with Maven', () => {
      try {
        execFileSync('mvn', ['-q', '-B', 'test-compile'],
          {cwd: projectDir, encoding: 'utf8', stdio: 'pipe'})
      }
      catch (err) {
        throw new Error('Maven compilation failed:\n' +
          `${(err.stdout || '').trim()}\n${(err.stderr || '').trim()}`)
      }
    }, 600000)

    it('builds session capabilities the Selenium client accepts', () => {
      fs.copyFileSync(SESSION_CHECK_SOURCE,
        path.join(projectDir, ...SOURCE_PACKAGE_DIR, 'SessionCapabilitiesCheck.java'))
      const classpathFile = path.join(projectDir, 'classpath.txt')
      const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java'

      try {
        execFileSync('mvn', ['-q', '-B', 'test-compile', 'dependency:build-classpath',
          `-Dmdep.outputFile=${classpathFile}`, '-Dmdep.includeScope=test'],
        {cwd: projectDir, encoding: 'utf8', stdio: 'pipe'})
        const classpath = [path.join(projectDir, 'target', 'test-classes'),
          fs.readFileSync(classpathFile, 'utf-8').trim()].join(path.delimiter)
        const output = execFileSync(java,
          ['-cp', classpath, 'com.kobiton.scriptlessautomation.SessionCapabilitiesCheck'],
          {cwd: projectDir, encoding: 'utf8', stdio: 'pipe'})
        expect(output).toContain('Validated W3C session capabilities')
      }
      catch (err) {
        throw new Error('Session capabilities check failed:\n' +
          `${(err.stdout || '').trim()}\n${(err.stderr || '').trim()}`)
      }
    }, 600000)
  })
})
