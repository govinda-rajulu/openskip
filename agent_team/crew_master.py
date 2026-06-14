import os
from crewai import Agent, Task, Crew, Process, LLM
from crewai_tools import FileReadTool

# 1. Bypass default API checks
os.environ["OPENAI_API_KEY"] = "NA"

# 2. Open-ended tools (Let agents choose the file path dynamically based on instructions)
file_reader_tool = FileReadTool()

# 3. Connect our free local Ollama engines
# Master needs a bit more brainpower to manage and summarize
master_brain = LLM(
    model="ollama/llama3.1:8b",  # <-- Added .1 here
    base_url="http://localhost:11434",
    temperature=0.2
)

# Slaves are ultra-lightweight and specialized
deepseek_slave = LLM(
    model="ollama/deepseek-r1:1.5b", 
    base_url="http://localhost:11434", 
    temperature=0.1
)

qwen_slave = LLM(
    model="ollama/qwen2.5-coder:1.5b", 
    base_url="http://localhost:11434",
    temperature=0.1
)

# 4. Set up the Master (Manager)
project_manager = Agent(
    role='Codebase Architecture Manager',
    goal='Oversee specialized slave agents to compile a comprehensive Chrome Extension review.',
    backstory='You manage timelines, delegate code file analysis to specialists, and synthesize their raw findings into a clean master report.',
    verbose=True,
    llm=master_brain
)

# 5. Set up specialized Slaves
extension_auditor = Agent(
    role='Chrome Extension Quality Engineer',
    goal='Read manifest configurations and ensure security and permission compliance.',
    backstory='You look for security flaws, extra heavy permissions, or deprecations in Chrome Extensions.',
    tools=[file_reader_tool],
    verbose=True,
    llm=deepseek_slave
)

js_optimizer = Agent(
    role='JavaScript Performance Specialist',
    goal='Read code logic and identify code optimizations or potential runtime bugs.',
    backstory='You scan front-end JavaScript logic to make sure features run smoothly without memory leaks.',
    tools=[file_reader_tool],
    verbose=True,
    llm=qwen_slave
)

# 6. Define Assignments with explicit file paths in descriptions
task_manifest_check = Task(
    description='Examine the chrome extension manifest file located at "../manifest.json" using your file read tool.',
    expected_output='A security audit report detailing permissions and background script declarations.',
    agent=extension_auditor
)

task_js_check = Task(
    description='Analyze the popup.js script file logic located at "../popup.js" using your file read tool.',
    expected_output='A code-review report outlining optimizations for performance.',
    agent=js_optimizer
)

# 7. Execute with Hierarchical Master-Slave structure!
print("🚀 Master directing Slave Agents onto extension codebase files...")
extension_crew = Crew(
    agents=[extension_auditor, js_optimizer],
    tasks=[task_manifest_check, task_js_check],
    manager_agent=project_manager,     # <-- The Master is now in control
    process=Process.hierarchical,      # <-- Forces the Master-Slave workflow
    verbose=True
)

final_report = extension_crew.kickoff()

print("\n==========================================")
print("🎯 SLAVE AGENT MASTER REPORT SUBMITTED:")
print("==========================================\n")
print(final_report)