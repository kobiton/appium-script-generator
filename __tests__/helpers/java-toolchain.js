import {execFileSync} from 'child_process'

const MIN_JAVA_VERSION = 17

/**
 * Returns the Java major version Maven runs on, or null when mvn is not available.
 */
export function getMavenJavaVersion() {
  try {
    const output = execFileSync('mvn', ['-v'], {encoding: 'utf8', stdio: 'pipe'})
    const match = output.match(/Java version: (\d+)(?:\.(\d+))?/)
    if (!match) return null

    const major = Number(match[1])
    // Legacy "1.8" style versions
    return major === 1 ? Number(match[2]) : major
  }
  catch (err) {
    return null
  }
}

export function hasJavaToolchain() {
  const version = getMavenJavaVersion()
  return version !== null && version >= MIN_JAVA_VERSION
}

export {MIN_JAVA_VERSION}
